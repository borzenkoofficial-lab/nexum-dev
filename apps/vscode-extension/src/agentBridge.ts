import * as vscode from "vscode";
import { OllamaClient } from "./ollamaClient.js";

type WriteAction = { type: "write"; path: string; content: string };
type DeleteAction = { type: "delete"; path: string };
type AgentPlan = { summary: string; actions: Array<WriteAction | DeleteAction> };

const BLOCKED = new Set([".git", "node_modules", "dist", ".next", ".nexum"]);
const MAX_FILES = 120;
const MAX_FILE_BYTES = 500_000;
const MAX_CONTEXT = 180_000;
const MAX_ACTIONS = 20;

export class AgentBridge {
  constructor(private readonly client: OllamaClient, private readonly model: string) {}

  async propose(task: string): Promise<AgentPlan> {
    const files = await vscode.workspace.findFiles("**/*", "{**/.git/**,**/node_modules/**,**/dist/**,**/.next/**,**/.nexum/**}", MAX_FILES);
    let context = "";
    for (const uri of files) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > MAX_FILE_BYTES) continue;
        const content = Buffer.from(bytes).toString("utf8");
        const rel = vscode.workspace.asRelativePath(uri);
        const chunk = "\n\n--- FILE: " + rel + " ---\n" + content;
        if (context.length + chunk.length > MAX_CONTEXT) break;
        context += chunk;
      } catch {
        // Skip unreadable files.
      }
    }
    const prompt = [
      "You are Nexum Agent operating inside a VS Code workspace.",
      "Return ONLY valid JSON. No markdown or code fences.",
      "Schema: {summary:string,actions:[{type:write,path:string,content:string}|{type:delete,path:string}]}",
      "Use workspace-relative paths only. Never use .. or absolute paths.",
      "Never touch .git, node_modules, dist, .next or .nexum.",
      "Maximum 20 actions. Preserve unrelated functionality. Make the smallest complete change.",
      "",
      "TASK:", task,
      "",
      "WORKSPACE CONTEXT:", context
    ].join("\n");
    const raw = await this.client.chat(this.model, prompt, "");
    return this.parseAndValidate(raw);
  }

  async apply(plan: AgentPlan): Promise<void> {
    if (!vscode.workspace.isTrusted) throw new Error("Workspace Trust is required before Nexum can modify files.");
    const root = vscode.workspace.workspaceFolders?.[0];
    if (!root) throw new Error("Open a workspace folder first.");
    for (const action of plan.actions) {
      const uri = this.safeUri(root.uri, action.path);
      if (action.type === "write") {
        const bytes = Buffer.from(action.content, "utf8");
        if (bytes.byteLength > MAX_FILE_BYTES) throw new Error("Generated file is too large: " + action.path);
        await vscode.workspace.fs.writeFile(uri, bytes);
      } else {
        await vscode.workspace.fs.delete(uri, { useTrash: true, recursive: false });
      }
    }
  }

  private parseAndValidate(raw: string): AgentPlan {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start < 0 || end <= start) throw new Error("Local AI did not return a valid JSON plan.");
      try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { throw new Error("Local AI returned malformed JSON."); }
    }
    if (!parsed || typeof parsed !== "object") throw new Error("Invalid agent plan.");
    const value = parsed as Partial<AgentPlan>;
    if (typeof value.summary !== "string" || !Array.isArray(value.actions)) throw new Error("Invalid agent plan schema.");
    if (value.actions.length > MAX_ACTIONS) throw new Error("Agent proposed too many file changes.");
    const actions = value.actions.map((item) => {
      if (!item || typeof item !== "object") throw new Error("Invalid agent action.");
      const action = item as Partial<WriteAction & DeleteAction>;
      if ((action.type !== "write" && action.type !== "delete") || typeof action.path !== "string") throw new Error("Invalid agent action.");
      if (action.type === "write" && typeof action.content !== "string") throw new Error("Write action is missing content.");
      if (action.type === "write" && Buffer.byteLength(action.content, "utf8") > MAX_FILE_BYTES) throw new Error("Generated file is too large.");
      this.validateRelativePath(action.path);
      return action.type === "write"
        ? { type: "write", path: action.path, content: action.content } as WriteAction
        : { type: "delete", path: action.path } as DeleteAction;
    });
    return { summary: value.summary.slice(0, 4000), actions };
  }

  private validateRelativePath(relativePath: string): void {
    if (!relativePath || relativePath.length > 500 || relativePath.includes("\\") || relativePath.startsWith("/") || /^[A-Za-z]:/.test(relativePath)) throw new Error("Unsafe workspace path: " + relativePath);
    const parts = relativePath.split("/");
    if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("Unsafe workspace path: " + relativePath);
    if (parts.some((part) => BLOCKED.has(part))) throw new Error("Protected workspace path: " + relativePath);
  }

  private safeUri(root: vscode.Uri, relativePath: string): vscode.Uri {
    this.validateRelativePath(relativePath);
    return vscode.Uri.joinPath(root, ...relativePath.split("/"));
  }
}
