import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { GitTool } from "./git.js";
import { assertWritableProjectPath, ProjectPathError } from "./path.js";

async function exists(path: string): Promise<boolean> {
  return stat(path).then(() => true, () => false);
}

async function tempProject(): Promise<{ root: string; project: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), "kvard-git-"));
  const project = join(root, "project");
  await mkdir(project);
  return { root, project, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function gitInit(project: string): void {
  execFileSync("git", ["init", "-q", project], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: "/tmp", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
}

test("a .git gitfile redirecting to an attacker-controlled config is refused and executes nothing", async () => {
  const { root, project, cleanup } = await tempProject();
  try {
    const marker = join(root, "PWNED");
    await mkdir(join(project, "evil", "objects"), { recursive: true });
    await mkdir(join(project, "evil", "refs"), { recursive: true });
    await writeFile(join(project, ".git"), "gitdir: evil\n");
    await writeFile(join(project, "evil", "HEAD"), "ref: refs/heads/main\n");
    await writeFile(join(project, "evil", "config"), `[core]\n\trepositoryformatversion = 0\n\tfsmonitor = "touch ${marker}; false"\n`);
    for (const operation of ["status", "diff", "diff-stat", "log", "branch"]) {
      const result = await new GitTool(project).execute(operation);
      assert.equal(result.success, false, operation);
    }
    assert.equal(await exists(marker), false, "repository config must never execute a command on the API host");
  } finally {
    await cleanup();
  }
});

test("a real repository with executable config settings is refused before git runs", async () => {
  const { root, project, cleanup } = await tempProject();
  try {
    gitInit(project);
    const marker = join(root, "PWNED");
    const dangerous = [
      `[core]\n\tfsmonitor = "touch ${marker}; false"\n`,
      `[core]\n\thooksPath = /tmp\n`,
      `[diff "x"]\n\ttextconv = touch ${marker}\n`,
      `[filter "x"]\n\tclean = touch ${marker}\n`,
      `[include]\n\tpath = /tmp/other.config\n`,
      `[includeIf "gitdir:/"]\n\tpath = /tmp/other.config\n`,
    ];
    for (const extra of dangerous) {
      await writeFile(join(project, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n\tbare = false\n${extra}`);
      const result = await new GitTool(project).execute("status");
      assert.equal(result.success, false, extra);
      assert.match(result.stderr, /not allowed|refused/i, extra);
    }
    assert.equal(await exists(marker), false);
  } finally {
    await cleanup();
  }
});

test("a plain git init repository still works for read-only operations", async () => {
  const { project, cleanup } = await tempProject();
  try {
    gitInit(project);
    const result = await new GitTool(project).execute("status");
    assert.equal(result.success, true, result.stderr);
  } finally {
    await cleanup();
  }
});

test("project writes can never create or modify any .git path segment", async () => {
  const { project, cleanup } = await tempProject();
  try {
    for (const path of [".git", ".git/config", "./.git", "src/.git", "src/.git/hooks/pre-commit", ".GIT/config", "a/.Git"]) {
      await assert.rejects(assertWritableProjectPath(project, path), ProjectPathError, path);
    }
    await assertWritableProjectPath(project, "src/app.git.ts");
    await assertWritableProjectPath(project, ".gitignore");
  } finally {
    await cleanup();
  }
});

test("agent writeFile and patchFile tools refuse Git metadata paths", async () => {
  const { ProjectWorkspace } = await import("./workspace.js");
  const { WriteFileTool } = await import("./writeFile.js");
  const { PatchFileTool } = await import("./patchFile.js");
  const { project, cleanup } = await tempProject();
  try {
    gitInit(project);
    const workspace = new ProjectWorkspace(project);
    for (const path of [".git", ".git/config", "nested/.git/config"]) {
      const written = await new WriteFileTool(workspace).execute(JSON.stringify({ path, content: "[core]\n\tfsmonitor = true\n" }));
      assert.equal(written.success, false, path);
    }
    const patched = await new PatchFileTool(workspace).execute(JSON.stringify({ path: ".git/config", find: "bare = false", replace: "bare = false\n\tfsmonitor = true" }));
    assert.equal(patched.success, false);
    const { readFile } = await import("node:fs/promises");
    assert.doesNotMatch(await readFile(join(project, ".git", "config"), "utf8"), /fsmonitor/);
    const ok = await new WriteFileTool(workspace).execute(JSON.stringify({ path: "src/app.ts", content: "export {};\n" }));
    assert.equal(ok.success, true, ok.output);
  } finally {
    await cleanup();
  }
});

test("runCommand git goes through the same repository hardening", async () => {
  const { RunCommandTool } = await import("./runCommand.js");
  const { root, project, cleanup } = await tempProject();
  try {
    gitInit(project);
    const marker = join(root, "PWNED");
    await writeFile(join(project, ".git", "config"), `[core]\n\trepositoryformatversion = 0\n\tfsmonitor = "touch ${marker}; false"\n`);
    const refused = await new RunCommandTool(project).execute("git status");
    assert.equal(refused.success, false);
    assert.match((refused as { stderr?: string }).stderr ?? refused.output, /refused/i);
    assert.equal(await exists(marker), false);
    await writeFile(join(project, ".git", "config"), "[core]\n\trepositoryformatversion = 0\n\tbare = false\n");
    const allowed = await new RunCommandTool(project).execute("git --no-pager status");
    assert.equal(allowed.success, true, allowed.output);
  } finally {
    await cleanup();
  }
});
