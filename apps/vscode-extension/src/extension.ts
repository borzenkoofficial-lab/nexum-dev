import * as vscode from "vscode";
import { OllamaClient } from "./ollamaClient.js";
import { AgentBridge } from "./agentBridge.js";
import { detectProject, diagnosticsText, runProjectCheck } from "./taskRunner.js";
import { repairLoop } from "./repairLoop.js";

function config() {
  const c = vscode.workspace.getConfiguration("nexum");
  return {
    url: c.get<string>("ollamaUrl", "http://127.0.0.1:11434").replace(/\/+$/, ""),
    model: c.get<string>("defaultModel", "qwen3:4b")
  };
}
function client() { return new OllamaClient(config().url); }
async function context() {
  const e = vscode.window.activeTextEditor;
  if (!e) return "No active file.";
  const selected = !e.selection.isEmpty ? e.document.getText(e.selection) : e.document.getText();
  return "FILE: " + vscode.workspace.asRelativePath(e.document.uri) + "\nLANGUAGE: " + e.document.languageId + "\nCONTENT:\n" + selected.slice(0, 30000);
}
async function check() {
  const s = await client().status();
  if (!s.available) { void vscode.window.showErrorMessage("Nexum Local AI: " + (s.error ?? "Ollama unavailable")); return; }
  const m = await client().listModels();
  void vscode.window.showInformationMessage("Nexum Local AI online — Ollama " + (s.version ?? "unknown") + ", " + m.length + " model(s).");
}
async function install() {
  const input = await vscode.window.showInputBox({ title: "Install local AI model", prompt: "Ollama model name", value: config().model, placeHolder: "qwen3:4b" });
  if (!input) return;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Nexum: installing " + input }, async () => {
    try { await client().pull(input.trim()); void vscode.window.showInformationMessage("Nexum: " + input + " installed locally."); }
    catch (e) { void vscode.window.showErrorMessage(e instanceof Error ? e.message : "Model installation failed."); }
  });
}
async function ask() {
  const prompt = await vscode.window.showInputBox({ title: "Ask Nexum Local AI", prompt: "Development task", placeHolder: "Analyze this file and propose a fix..." });
  if (!prompt) return;
  const model = config().model;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Nexum: asking " + model }, async () => {
    try {
      const answer = await client().chat(model, prompt, await context());
      const d = await vscode.workspace.openTextDocument({ language: "markdown", content: "# Nexum Local AI\n\nModel: " + model + "\n\n" + answer + "\n" });
      await vscode.window.showTextDocument(d, vscode.ViewColumn.Beside);
    } catch (e) { void vscode.window.showErrorMessage(e instanceof Error ? e.message : "Local AI request failed."); }
  });
}
async function agent() {
  if (!vscode.workspace.isTrusted) { void vscode.window.showWarningMessage("Nexum Agent requires a trusted workspace before it can modify files."); return; }
  const task = await vscode.window.showInputBox({ title: "Nexum Agent", prompt: "Describe the change you want Nexum to implement", placeHolder: "Build the landing page and fix any TypeScript errors..." });
  if (!task) return;
  const model = config().model;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Nexum: planning changes" }, async () => {
    try {
      const plan = await new AgentBridge(client(), model).propose(task);
      const changes = plan.actions.map((a) => a.type.toUpperCase() + " " + a.path).join("\n") || "No file changes proposed.";
      const choice = await vscode.window.showInformationMessage("Nexum plan: " + plan.summary, { modal: true, detail: changes }, "Apply", "Cancel");
      if (choice !== "Apply") return;
      await new AgentBridge(client(), model).apply(plan);
      void vscode.window.showInformationMessage("Nexum applied " + plan.actions.length + " change(s).");
    } catch (e) { void vscode.window.showErrorMessage(e instanceof Error ? e.message : "Nexum Agent failed."); }
  });
}
async function checkProject(kind: "build" | "test" | "lint" | "typecheck") {
  try {
    const result = await runProjectCheck(kind);
    const diagnostics = diagnosticsText();
    const detail = (result.output + (diagnostics ? "\n\nDiagnostics:\n" + diagnostics : "")).slice(-12000);
    if (result.ok && !diagnostics) void vscode.window.showInformationMessage("Nexum " + kind + ": clean.");
    else void vscode.window.showErrorMessage("Nexum " + kind + ": errors detected.", { modal: true, detail });
  } catch (e) {
    void vscode.window.showErrorMessage(e instanceof Error ? e.message : "Project check failed.");
  }
}

async function repair() {
  const task = await vscode.window.showInputBox({ title: "Nexum Repair Loop", prompt: "What should be working after repair?", value: "Fix the project until the build and diagnostics are clean." });
  if (!task) return;
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Nexum: repair loop" }, async () => {
      await repairLoop(new AgentBridge(client(), config().model), task, 3);
    });
  } catch (e) {
    void vscode.window.showErrorMessage(e instanceof Error ? e.message : "Nexum repair loop failed.");
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(
    vscode.commands.registerCommand("nexum.checkLocalAI", check),
    vscode.commands.registerCommand("nexum.installModel", install),
    vscode.commands.registerCommand("nexum.askLocalAI", ask),
    vscode.commands.registerCommand("nexum.openAgent", agent),
    vscode.commands.registerCommand("nexum.buildProject", () => checkProject("build")),
    vscode.commands.registerCommand("nexum.testProject", () => checkProject("test")),
    vscode.commands.registerCommand("nexum.lintProject", () => checkProject("lint")),
    vscode.commands.registerCommand("nexum.typecheckProject", () => checkProject("typecheck")),
    vscode.commands.registerCommand("nexum.inspectProject", async () => { try { void vscode.window.showInformationMessage("Nexum profile: " + JSON.stringify(await detectProject())); } catch (e) { void vscode.window.showErrorMessage(e instanceof Error ? e.message : "Project inspection failed."); } }),
    vscode.commands.registerCommand("nexum.repairProject", repair)
  );
}
export function deactivate() {}
