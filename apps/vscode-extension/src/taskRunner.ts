import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 20000;

export type ProjectProfile = {
  packageManager: "npm" | "pnpm" | "yarn" | "bun";
  scripts: string[];
  buildScript?: string;
  testScript?: string;
  lintScript?: string;
  typecheckScript?: string;
  framework: string;
};
export type CheckResult = { ok: boolean; command: string; output: string; profile: ProjectProfile };

async function readJson(root: vscode.Uri, name: string): Promise<Record<string, any> | null> {
  try { return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.joinPath(root, name))).toString("utf8")); }
  catch { return null; }
}

export async function detectProject(): Promise<ProjectProfile> {
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) throw new Error("Open a workspace folder first.");
  const pkg = await readJson(root.uri, "package.json");
  if (!pkg) return { packageManager: "npm", scripts: [], framework: "unknown" };
  let packageManager: ProjectProfile["packageManager"] = "npm";
  const files = await vscode.workspace.fs.readDirectory(root.uri);
  const names = new Set(files.map(([name]) => name));
  if (names.has("pnpm-lock.yaml")) packageManager = "pnpm";
  else if (names.has("yarn.lock")) packageManager = "yarn";
  else if (names.has("bun.lockb") || names.has("bun.lock")) packageManager = "bun";
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  let framework = "unknown";
  if (deps.next) framework = "next";
  else if (deps.vite) framework = "vite";
  else if (deps["@angular/core"]) framework = "angular";
  else if (deps.react) framework = "react";
  else if (deps.vue) framework = "vue";
  else if (deps.svelte) framework = "svelte";
  else if (deps.express || deps.fastify || deps.hono) framework = "node-api";
  const scripts = Object.keys(pkg.scripts ?? {});
  const pick = (names: string[]) => names.find((name) => scripts.includes(name));
  return { packageManager, scripts, framework, buildScript: pick(["build", "compile"]), testScript: pick(["test", "test:run", "test:ci"]), lintScript: pick(["lint"]), typecheckScript: pick(["typecheck", "type-check", "tsc"]), };
}

function runner(manager: ProjectProfile["packageManager"]) {
  if (manager === "pnpm") return "pnpm";
  if (manager === "yarn") return "yarn";
  if (manager === "bun") return "bun";
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export async function runProjectCheck(kind: "build" | "test" | "lint" | "typecheck"): Promise<CheckResult> {
  if (!vscode.workspace.isTrusted) throw new Error("Workspace Trust is required before running project checks.");
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) throw new Error("Open a workspace folder first.");
  const profile = await detectProject();
  const script = kind === "build" ? profile.buildScript : kind === "test" ? profile.testScript : kind === "lint" ? profile.lintScript : profile.typecheckScript;
  if (!script) return { ok: true, command: "none", output: "No " + kind + " script configured; check skipped.", profile };
  const executable = runner(profile.packageManager);
  const args = profile.packageManager === "npm" ? ["run", script] : ["run", script];
  const command = executable + " run " + script;
  try {
    const result = await execFileAsync(executable, args, { cwd: root.uri.fsPath, timeout: 180000, maxBuffer: 2_000_000 });
    return { ok: true, command, output: (result.stdout + "\n" + result.stderr).trim().slice(-MAX_OUTPUT), profile };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, command, output: ((e.stdout ?? "") + "\n" + (e.stderr ?? "") + "\n" + (e.message ?? "")).trim().slice(-MAX_OUTPUT), profile };
  }
}

export function diagnosticsText(): string {
  const entries: string[] = [];
  vscode.languages.getDiagnostics().forEach(([uri, diagnostics]) => {
    for (const d of diagnostics.slice(0, 20)) entries.push(vscode.workspace.asRelativePath(uri) + ":" + (d.range.start.line + 1) + ":" + (d.range.start.character + 1) + " " + d.message);
  });
  return entries.slice(0, 100).join("\n");
}
