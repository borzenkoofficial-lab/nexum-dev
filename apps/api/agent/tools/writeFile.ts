import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import type { Tool, ToolResult } from "../types.js";
import { ProjectWorkspace } from "./workspace.js";

export interface WriteFileRequest { path: string; content: string; }

const hash=(value:string)=>createHash("sha256").update(value,"utf8").digest("hex");

export class WriteFileTool implements Tool {
  name = "writeFile";
  description = "Creates or updates a text file inside the active project. Path must be relative.";
  constructor(private readonly workspace: ProjectWorkspace) {}
  async execute(input: string): Promise<ToolResult> {
    try {
      const request = JSON.parse(input) as Partial<WriteFileRequest>;
      if (typeof request.path !== "string" || typeof request.content !== "string") return { success:false, output:"writeFile expects JSON: { path, content }" };
      const filePath = await this.workspace.writable(request.path);
      const previous = await readFile(filePath, "utf8").catch(() => null);
      const next = request.content;
      if (previous === next) {
        return {
          success: true,
          output: JSON.stringify({ path: this.workspace.relative(filePath), changed: false, idempotent: true, previousBytes: Buffer.byteLength(next), newBytes: Buffer.byteLength(next), previousSha256: hash(next), newSha256: hash(next) }),
        };
      }
      await mkdir(dirname(filePath), { recursive:true });
      await writeFile(filePath, next, "utf8");
      return {
        success:true,
        output:JSON.stringify({
          path: this.workspace.relative(filePath),
          changed:true,
          idempotent:false,
          previousBytes: previous === null ? 0 : Buffer.byteLength(previous),
          newBytes: Buffer.byteLength(next),
          previousSha256: previous === null ? null : hash(previous),
          newSha256: hash(next),
        }),
      };
    } catch (error) { return { success:false, output:error instanceof Error ? error.message : "Unable to write file" }; }
  }
}
