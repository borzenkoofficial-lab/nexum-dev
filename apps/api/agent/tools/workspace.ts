import { access, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export class ProjectWorkspace {
  constructor(public readonly root: string) {}

  resolve(requestedPath = "."): string {
    const input = requestedPath.trim();
    if (!input) throw new Error("Project path is required");
    if (isAbsolute(input)) throw new Error("Tool paths must be relative to the active project");
    const normalized = input.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized === ".") return resolve(this.root);
    const target = resolve(this.root, normalized);
    const rel = relative(this.root, target);
    if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Path must stay inside the active project");
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

  async writable(requestedPath: string): Promise<string> {
    const target = this.resolve(requestedPath);
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
