import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AIGateway } from "../ai/gateway.js";
import { MockProvider } from "../ai/providers/mock.js";
import { NexumAgent } from "../agent/agent.js";
import { DockerSandbox } from "../sandbox/dockerSandbox.js";
import { ProjectManager } from "./projectManager.js";

async function createManager(): Promise<{ root: string; manager: ProjectManager }> {
  const root = await mkdtemp(join(tmpdir(), "nexum-project-manager-"));
  return { root, manager: new ProjectManager(root) };
}

test("creates, lists and gets projects", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  const project = await manager.createProject("Gruzli");
  const projects = await manager.listProjects();
  const loaded = await manager.getProject(project.id);

  assert.equal(project.id, "gruzli");
  assert.equal(project.status, "active");
  assert.equal(projects.some((item) => item.id === "gruzli"), true);
  assert.deepEqual(loaded, project);
});

test("creates safe ids for Cyrillic project names", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  const project = await manager.createProject("Мой проект");
  assert.equal(project.id, "moy-proekt");
  assert.equal(project.status, "active");
});

test("selects and permanently deletes a project and its files", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  const project = await manager.createProject("Gruzli");
  await manager.selectProject(project.id);
  assert.equal((await manager.getActiveProject()).id, project.id);

  await writeFile(join(project.path, "keep.txt"), "keep", "utf8");
  const deleted = await manager.deleteProject(project.id);
  assert.equal(deleted.id, project.id);
  await assert.rejects(() => readFile(join(project.path, "keep.txt"), "utf8"));
  assert.equal((await manager.listProjects()).some((item) => item.id === project.id), false);
  assert.equal((await manager.getActiveProject()).id, "nexum");
});

test("rejects traversal, absolute names and symlink project paths", async () => {
  const { root, manager } = await createManager();
  await manager.initialize();

  await assert.rejects(() => manager.createProject("../escape"), /Project name/);
  await assert.rejects(() => manager.createProject("/tmp/escape"), /Project name/);

  const outside = await mkdtemp(join(tmpdir(), "nexum-project-outside-"));
  await symlink(outside, join(root, "projects", "linked"));
  await assert.rejects(() => manager.createProject("Linked"), /symlink/);
});

test("keeps project directories isolated and scopes Agent tools", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  const first = await manager.createProject("First");
  const second = await manager.createProject("Second");
  const gateway = new AIGateway([new MockProvider()]);
  const agent = new NexumAgent(gateway, first.path);

  await agent.executeTool("writeFile", JSON.stringify({ path: "note.txt", content: "first" }));
  const readResult = await agent.executeTool("readFile", "note.txt");
  const commandResult = await agent.executeTool("runCommand", "node --version");

  assert.equal(readResult.success, true);
  assert.match(readResult.output, /first/);
  assert.equal(commandResult.success, true);
  await assert.rejects(() => readFile(join(second.path, "note.txt")));
});

test("runs Sandbox relative to the selected project path", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  const project = await manager.createProject("Sandbox Project");
  const sandbox = new DockerSandbox(project.path);

  assert.equal(sandbox.getWorkspaceRoot(), project.path);
});

test("scaffolds a runnable web preview inside the active project", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  const project = await manager.createProject("Preview App");
  const agent = new NexumAgent(new AIGateway([new MockProvider()]), project.path);

  const result = await agent.executeTool("scaffoldProject", "Создай приложение для портфолио строительной компании");
  assert.equal(result.success, true);
  assert.equal((await readFile(join(project.path, "index.html"), "utf8")).includes("<!doctype html>"), true);
  assert.match(await readFile(join(project.path, "style.css"), "utf8"), /body/);
  assert.match(await readFile(join(project.path, "app.js"), "utf8"), /NEXUM project foundation/);
});

test("creates a React/Vite scaffold for SPA requests", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  const project = await manager.createProject("React Preview");
  const agent = new NexumAgent(new AIGateway([new MockProvider()]), project.path);

  const result = await agent.executeTool("scaffoldProject", "Создай React приложение для портфолио");
  assert.equal(result.success, true);
  const packageJson = JSON.parse(await readFile(join(project.path, "package.json"), "utf8")) as { scripts?: { build?: string } };
  assert.equal(packageJson.scripts?.build, "vite build");
  assert.match(await readFile(join(project.path, "src/App.jsx"), "utf8"), /nexum-root/);
  assert.equal((await readFile(join(project.path, "vite.config.js"), "utf8")).includes("@vitejs/plugin-react"), true);
});


test("protects the default NEXUM project from permanent deletion", async () => {
  const { manager } = await createManager();
  await manager.initialize();
  await assert.rejects(() => manager.deleteProject("nexum"), /cannot be deleted/);
});
