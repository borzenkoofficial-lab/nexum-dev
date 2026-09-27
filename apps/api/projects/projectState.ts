import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ProductPlan } from "../agent/types.js";

export interface ProjectState {
  version: 2;
  projectId: string;
  projectType: "static" | "node" | "react" | "unknown";
  framework: string | null;
  entryFiles: string[];
  existingFiles: string[];
  dependencies: string[];
  buildCommand: string | null;
  previewMode: "static" | "built-app" | "unknown";
  currentGoal: string | null;
  completedActions: string[];
  failedActions: string[];
  changedFiles: string[];
  knownErrors: string[];
  lastSuccessfulBuildAt?: string | null;
  lastFailedTool?: string | null;
  architecture: string[];
  designSystem: string[];
  routes: string[];
  updatedAt: string;
}

export class ProjectStateManager {
  private readonly fileName = ".nexum/state.json";

  constructor(private readonly projectRoot: string, private readonly projectId: string) {}

  private get path() { return resolve(this.projectRoot, this.fileName); }

  async read(): Promise<ProjectState | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as ProjectState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async refresh(goal?: string, plan?: ProductPlan, changedFiles: string[] = [], errors: string[] = []): Promise<ProjectState> {
    const files = await this.collectFiles();
    let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try { pkg = JSON.parse(await readFile(resolve(this.projectRoot, "package.json"), "utf8")); } catch {}
    const deps = Object.keys({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });
    const framework = deps.includes("next") ? "Next.js" : deps.includes("vite") ? "Vite" : deps.includes("react") ? "React" : null;
    const projectType = framework === "Next.js" ? "react" : framework ? "react" : files.includes("package.json") ? "node" : files.includes("index.html") ? "static" : "unknown";
    const previous = await this.read();
    const successfulChanges = [...new Set([...(previous?.changedFiles ?? []), ...changedFiles])].slice(-100);
    const state: ProjectState = {
      version: 1,
      projectId: this.projectId,
      projectType,
      framework,
      entryFiles: files.filter((f) => /^(index\.html|src\/main\.(tsx?|jsx?)|src\/App\.(tsx?|jsx?)|app\/page\.(tsx?|jsx?)|pages\/index\.(tsx?|jsx?))$/.test(f)),
      existingFiles: files.slice(0, 1000),
      dependencies: deps.sort(),
      buildCommand: typeof pkg.scripts?.build === "string" ? pkg.scripts.build : null,
      previewMode: files.includes("package.json") ? (await this.exists("dist/index.html") ? "built-app" : "unknown") : files.includes("index.html") ? "static" : "unknown",
      currentGoal: goal ?? previous?.currentGoal ?? null,
      completedActions: previous?.completedActions ?? [],
      failedActions: errors.length ? [...(previous?.failedActions ?? []), ...errors].slice(-50) : previous?.failedActions ?? [],
      changedFiles: successfulChanges,
      knownErrors: errors.length ? [...new Set([...(previous?.knownErrors ?? []), ...errors])].slice(-50) : previous?.knownErrors ?? [],
      lastSuccessfulBuildAt: previous?.lastSuccessfulBuildAt ?? null,
      lastFailedTool: errors.length ? errors.at(-1)?.split(":")[0] ?? null : previous?.lastFailedTool ?? null,
      architecture: plan ? [`${plan.productType}: ${plan.pages.join(", ")}`, ...plan.components].slice(0, 50) : previous?.architecture ?? [],
      designSystem: plan?.visualSystem ?? previous?.designSystem ?? [],
      routes: plan?.pages ?? previous?.routes ?? [],
      updatedAt: new Date().toISOString(),
    };
    await this.write(state);
    return state;
  }

  async markBuildSucceeded(): Promise<ProjectState> {
    const state = (await this.read()) ?? await this.refresh();
    state.lastSuccessfulBuildAt = new Date().toISOString();
    state.lastFailedTool = null;
    state.updatedAt = new Date().toISOString();
    await this.write(state);
    return state;
  }

  async markCompleted(action: string): Promise<ProjectState> {
    const state = (await this.read()) ?? await this.refresh();
    state.completedActions = [...new Set([...state.completedActions, action])].slice(-100);
    state.updatedAt = new Date().toISOString();
    await this.write(state);
    return state;
  }

  private async write(state: ProjectState) {
    await (await import("node:fs/promises")).mkdir(resolve(this.projectRoot, ".nexum"), { recursive: true });
    await writeFile(this.path, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  private async exists(relativePath: string) {
    try { await access(resolve(this.projectRoot, relativePath)); return true; } catch { return false; }
  }

  private async collectFiles(): Promise<string[]> {
    const { readdir } = await import("node:fs/promises");
    const root = this.projectRoot;
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const result: string[] = [];
      for (const entry of entries) {
        if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) result.push(...await walk(full));
        else result.push(full.slice(root.length + 1).replace(/\\/g, "/"));
      }
      return result;
    };
    return (await walk(root)).sort();
  }
}
