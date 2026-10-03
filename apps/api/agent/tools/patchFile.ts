import { readFile } from "node:fs/promises";
import { ProjectWorkspace } from "./workspace.js";
import type { ToolResult, Tool } from "../types.js";

interface PatchInput {
  path: string;
  find: string;
  replace: string;
  expectedMatches?: number;
}

export class PatchFileTool implements Tool {
  readonly name = "patchFile";
  readonly description = "Apply an exact targeted replacement inside an existing project file. Refuses ambiguous matches.";

  constructor(private readonly workspace: ProjectWorkspace) {}

  async execute(input: string): Promise<ToolResult> {
    let parsed: PatchInput;
    try {
      parsed = JSON.parse(input) as PatchInput;
    } catch {
      return { success: false, output: "patchFile input must be valid JSON." };
    }

    if (!parsed.path || typeof parsed.find !== "string" || typeof parsed.replace !== "string") {
      return { success: false, output: 'patchFile requires {"path","find","replace"}.' };
    }
    if (parsed.find.length === 0) return { success: false, output: "patchFile find cannot be empty." };

    try {
      const filePath = await this.workspace.existing(parsed.path);
      const before = await readFile(filePath, "utf8");
      const matches = before.split(parsed.find).length - 1;
      const expected = parsed.expectedMatches ?? 1;
      if (matches !== expected) {
        return {
          success: false,
          output: `Refused patch: expected ${expected} exact match(es), found ${matches}. Read the file and retry with a narrower target.`,
        };
      }

      const after = before.replace(parsed.find, parsed.replace);
      if (after === before) return { success: false, output: "Patch produced no change." };

      const { writeFile } = await import("node:fs/promises");
      await writeFile(filePath, after, "utf8");
      return {
        success: true,
        output: JSON.stringify({ path: this.workspace.relative(filePath), changed: true, replacements: matches, beforeBytes: Buffer.byteLength(before), afterBytes: Buffer.byteLength(after) }),
      };
    } catch (error) {
      return { success: false, output: error instanceof Error ? error.message : "Patch failed." };
    }
  }
}
