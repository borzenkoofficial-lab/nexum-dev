import * as vscode from "vscode";
import { AgentBridge } from "./agentBridge.js";
import { diagnosticsText, detectProject, runProjectCheck } from "./taskRunner.js";

export async function repairLoop(bridge: AgentBridge, task: string, maxIterations = 3): Promise<void> {
  if (!vscode.workspace.isTrusted) throw new Error("Workspace Trust is required for the repair loop.");
  const profile = await detectProject();
  const checks = [profile.buildScript ? "build" : "", profile.typecheckScript ? "typecheck" : "", profile.testScript ? "test" : "", profile.lintScript ? "lint" : ""].filter(Boolean).join(", ");
  for (let i = 1; i <= maxIterations; i++) {
    const check = await runProjectCheck(profile.buildScript ? "build" : profile.typecheckScript ? "typecheck" : "build");
    const diagnostics = diagnosticsText();
    if (check.ok && !diagnostics) {
      void vscode.window.showInformationMessage("Nexum Repair Loop: build and diagnostics are clean.");
      return;
    }
    const evidence = [
      "PROJECT PROFILE:", JSON.stringify(profile),
      "CHECKS AVAILABLE:", checks,
      "",
      "ORIGINAL TASK:", task,
      "",
      "BUILD COMMAND:", check.command,
      "BUILD OUTPUT:", check.output.slice(-12000),
      "",
      "VS CODE DIAGNOSTICS:", diagnostics.slice(-12000),
      "",
      "REPAIR ITERATION:", String(i) + "/" + String(maxIterations)
    ].join("\n");
    const plan = await bridge.propose("Repair the project using the following build/test evidence. Fix the root cause, not just the symptom.\n\n" + evidence);
    const changes = plan.actions.map((a) => a.type.toUpperCase() + " " + a.path).join("\n") || "No file changes proposed.";
    const choice = await vscode.window.showInformationMessage("Nexum repair proposal: " + plan.summary, { modal: true, detail: changes }, "Apply", "Stop");
    if (choice !== "Apply") return;
    await bridge.apply(plan);
  }
  void vscode.window.showWarningMessage("Nexum Repair Loop stopped after the maximum number of iterations.");
}
