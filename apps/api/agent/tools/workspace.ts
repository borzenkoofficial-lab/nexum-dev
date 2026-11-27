import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { isProtectedProjectPath } from "./path.js";

export class ProjectWorkspace {
  constructor(public readonly root: string) {}

  resolve(requestedPath = "."): string {
    const input = requestedPath.trim();
    if (!input) throw new Error("Project path is required");
    const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized === ".") return resolve(this.root);

    // Models sometimes return the already-resolved absolute project path.
    // Accept it only when it still points inside the active project.
    const target = isAbsolute(normalized)
      ? resolve(normalized)
      : resolve(this.root, normalized);
    const canonicalRoot = resolve(this.root);
    const rel = relative(canonicalRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error("Path must stay inside the active project");
    }
    return target;
  }

  relative(filePath: string): string {
    return relative(this.root, filePath).replace(/\\/g, "/") || ".";
  }

  async existing(requestedPath: string): Promise<string> {
    const target = this.resolve(requestedPath);
    await access(target);
    const [root, real] = await Promise.all([realpath(this.root), realpath(target)]);
    const rel = relative(root, real);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path must stay inside the active project");
    return target;
  }

  /** An existing file that a tool is about to modify (e.g. patchFile). */
  async existingWritable(requestedPath: string): Promise<string> {
    const target = await this.existing(requestedPath);
    this.assertNotProtected(target);
    return target;
  }

  /** Git metadata is never writable by agent tools (see GitTool for why). */
  private assertNotProtected(target: string): void {
    if (isProtectedProjectPath(resolve(this.root), target)) throw new Error("Writing Git metadata (.git) is not allowed");
  }

  async writable(requestedPath: string): Promise<string> {
    const target = this.resolve(requestedPath);
    this.assertNotProtected(target);
    const root = await realpath(this.root);
    let parent = dirname(target);
    while (true) {
      try {
        const realParent = await realpath(parent);
        const rel = relative(root, realParent);
        if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path must stay inside the active project");
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const next = dirname(parent);
        if (next === parent) throw new Error("Path must stay inside the active project");
        parent = next;
      }
    }
    return target;
  }
}
