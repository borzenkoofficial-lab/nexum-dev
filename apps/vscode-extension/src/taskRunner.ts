import * as vscode from "vscode";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ALLOWED = new Set(["build", "test", "check", "typecheck", "lint"]);

export type CheckResult = { ok: boolean; command: string; output: string };

export async function runProjectCheck(kind: "build" | "test"): Promise<CheckResult> {
  if (!vscode.workspace.isTrusted) throw new Error("Workspace Trust is required before running project checks.");
  const root = vscode.workspace.workspaceFolders?.[0];
  if (!root) throw new Error("Open a workspace folder first.");
  const packageUri = vscode.Uri.joinPath(root.uri, "package.json");
  let pkg: { scripts?: Record<string, string> };
  try { pkg = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(packageUri)).toString("utf8")); }
  catch { return { ok: true, command: "none", output: "No root package.json found; check skipped." }; }
  const script = pkg.scripts?.[kind];
  if (!script || !ALLOWED.has(kind)) return { ok: true, command: "none", output: "No " + kind + " script configured; check skipped." };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const command = npm + " run " + kind;
  try {
    const result = await execFileAsync(npm, ["run", kind], { cwd: root.uri.fsPath, timeout: 180000, maxBuffer: 2_000_000 });
    return { ok: true, command, output: (result.stdout + "\n" + result.stderr).trim() };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, command, output: ((e.stdout ?? "") + "\n" + (e.stderr ?? "") + "\n" + (e.message ?? "")).trim() };
  }
}

export function diagnosticsText(): string {
  const entries: string[] = [];
  vscode.languages.getDiagnostics().forEach(([uri, diagnostics]) => {
    for (const d of diagnostics.slice(0, 20)) {
      entries.push(vscode.workspace.asRelativePath(uri) + ":" + (d.range.start.line + 1) + ":" + (d.range.start.character + 1) + " " + d.message);
    }
  });
  return entries.slice(0, 100).join("\n");
}
