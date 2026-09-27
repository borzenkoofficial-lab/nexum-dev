import { access, cp, mkdir, lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { assertExistingProjectPath, resolveProjectPath } from "../agent/tools/path.js";
import type { Project, ProjectStatus, ProjectStore } from "./types.js";

export class ProjectManagerError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ProjectManagerError";
    this.statusCode = statusCode;
  }
}

export class ProjectManager {
  private readonly projectsRoot: string;
  private readonly storePath: string;
  private readonly defaultProject: Project;
  private initialized = false;

  constructor(private readonly workspaceRoot: string) {
    this.projectsRoot = resolve(workspaceRoot, "projects");
    this.storePath = resolve(workspaceRoot, ".nexum-projects.json");
    const now = new Date().toISOString();
    this.defaultProject = {
      id: "nexum",
      name: "NEXUM",
      path: resolve(this.projectsRoot, "nexum"),
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await mkdir(this.projectsRoot, { recursive: true });
    await mkdir(this.defaultProject.path, { recursive: true });
    const existing = await this.readStore();
    if (!existing) {
      await this.writeStore({ projects: [this.defaultProject], activeProjectId: this.defaultProject.id });
    } else if (!existing.projects.some((project) => project.id === this.defaultProject.id)) {
      existing.projects.unshift(this.defaultProject);
      await this.writeStore(existing);
    } else {
      const storedDefault = existing.projects.find((project) => project.id === this.defaultProject.id);
      if (storedDefault && resolve(storedDefault.path) !== resolve(this.defaultProject.path)) {
        storedDefault.path = this.defaultProject.path;
        storedDefault.updatedAt = new Date().toISOString();
        await this.writeStore(existing);
      }
    }
    await this.ensureStarterFiles(this.defaultProject);
    this.initialized = true;
  }

  async createProject(name: string): Promise<Project> {
    await this.initialize();
    const validName = this.validateName(name);
    const id = this.createId(validName);
    const store = await this.requireStore();

    if (store.projects.some((project) => project.id === id)) {
      throw new ProjectManagerError(`Project already exists: ${id}`, 409);
    }

    const projectPath = resolveProjectPath(this.projectsRoot, id);
    await this.assertProjectPath(projectPath);
    await mkdir(projectPath);

    const now = new Date().toISOString();
    const project: Project = {
      id,
      name: validName,
      path: projectPath,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    store.projects.push(project);
    await this.writeStore(store);
    await this.ensureStarterFiles(project);
    return project;
  }

  async duplicateProject(id: string): Promise<Project> {
    const source = await this.getProject(id);
    const store = await this.requireStore();
    const baseName = `${source.name} Copy`;
    let name = baseName;
    let suffix = 2;
    while (store.projects.some((project) => project.name.toLowerCase() === name.toLowerCase())) {
      name = `${baseName} ${suffix++}`;
    }
    const newId = this.createId(name);
    const projectPath = resolveProjectPath(this.projectsRoot, newId);
    await this.assertProjectPath(projectPath);
    await cp(source.path, projectPath, { recursive: true, force: false });
    const now = new Date().toISOString();
    const project: Project = { id: newId, name, path: projectPath, status: "active", createdAt: now, updatedAt: now };
    store.projects.push(project);
    await this.writeStore(store);
    return project;
  }

  async listProjects(): Promise<Project[]> {
    const store = await this.requireStore();
    return store.projects.map((project) => ({ ...project }));
  }

  async getProject(id: string): Promise<Project> {
    const store = await this.requireStore();
    this.validateId(id);
    const project = store.projects.find((item) => item.id === id);
    if (!project) throw new ProjectManagerError(`Project not found: ${id}`, 404);
    await this.assertStoredProject(project);
    return { ...project };
  }

  async getActiveProject(projectId?: string): Promise<Project> {
    const store = await this.requireStore();
    const id = projectId ?? store.activeProjectId;
    const project = await this.getProject(id);
    if (project.status !== "active") {
      throw new ProjectManagerError(`Project is archived: ${project.id}`, 409);
    }
    return project;
  }

  async selectProject(id: string): Promise<Project> {
    const project = await this.getProject(id);
    if (project.status !== "active") {
      throw new ProjectManagerError(`Project is archived: ${id}`, 409);
    }

    const store = await this.requireStore();
    store.activeProjectId = id;
    await this.writeStore(store);
    return project;
  }

  async archiveProject(id: string): Promise<Project> {
    const store = await this.requireStore();
    const project = await this.getProject(id);
    const now = new Date().toISOString();
    const archivedProject = { ...project, status: "archived" as ProjectStatus, updatedAt: now };
    store.projects = store.projects.map((item) => (item.id === id ? archivedProject : item));

    if (store.activeProjectId === id) {
      const fallback = store.projects.find((item) => item.status === "active");
      if (fallback) store.activeProjectId = fallback.id;
    }

    await this.writeStore(store);
    return archivedProject;
  }

  async deleteProject(id: string): Promise<Project> {
    return this.archiveProject(id);
  }

  private async requireStore(): Promise<ProjectStore> {
    await this.initialize();
    const store = await this.readStore();
    if (!store) throw new ProjectManagerError("Project store is unavailable", 500);
    return store;
  }

  private async readStore(): Promise<ProjectStore | null> {
    try {
      const content = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(content) as ProjectStore;
      if (!Array.isArray(parsed.projects) || typeof parsed.activeProjectId !== "string") {
        throw new ProjectManagerError("Project store is invalid", 500);
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      if (error instanceof ProjectManagerError) throw error;
      throw new ProjectManagerError("Unable to read project store", 500);
    }
  }

  private async writeStore(store: ProjectStore): Promise<void> {
    await writeFile(this.storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  }

  private async ensureStarterFiles(project: Project): Promise<void> {
    const files = [
      ["index.html", this.defaultIndexHtml(project.name)],
      ["style.css", this.defaultStyleCss()],
      ["app.js", this.defaultAppJs(project.name)],
    ] as const;

    for (const [name, content] of files) {
      const filePath = resolve(project.path, name);
      try {
        await access(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await writeFile(filePath, content, { encoding: "utf8", flag: "wx" });
      }
    }
  }

  private defaultIndexHtml(name: string): string {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <link rel="stylesheet" href="./style.css" />
</head>
<body>
  <main class="shell">
    <section class="card">
      <span class="eyebrow">NEXUM.DEV</span>
      <h1>${name}</h1>
      <p>Your project is ready. Ask the Agent to design and build it.</p>
      <button id="action">Start building</button>
    </section>
  </main>
  <script src="./app.js"></script>
</body>
</html>`;
  }

  private defaultStyleCss(): string {
    return `:root { font-family: Inter, system-ui, sans-serif; color: #111; background: #f4f4f0; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; }
.shell { min-height: 100vh; display: grid; place-items: center; padding: 32px; }
.card { width: min(720px, 100%); padding: 48px; border: 1px solid #ddd; border-radius: 24px; background: white; box-shadow: 0 20px 60px rgba(0,0,0,.08); }
.eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .16em; color: #666; }
h1 { font-size: clamp(40px, 8vw, 76px); line-height: .95; margin: 16px 0; }
p { color: #666; font-size: 18px; line-height: 1.5; }
button { border: 0; border-radius: 12px; padding: 14px 20px; background: #111; color: white; font-weight: 700; cursor: pointer; }`;
  }

  private defaultAppJs(name: string): string {
    return `document.getElementById("action")?.addEventListener("click", () => {
  document.querySelector("p").textContent = "NEXUM Agent can now replace this starter with your real product.";
  document.title = "${name} — NEXUM";
});`;
  }

  private validateName(name: string): string {
    const value = name.trim();
    if (!value || value.length > 64 || !/^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u.test(value)) {
      throw new ProjectManagerError("Project name must be 1-64 letters, numbers, spaces, _ or -");
    }
    return value;
  }

  private createId(name: string): string {
    const transliteration: Record<string, string> = {
      а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i",
      й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t",
      у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "",
      э: "e", ю: "yu", я: "ya",
    };
    const normalized = [...name.toLowerCase()].map((char) => transliteration[char] ?? char).join("");
    const id = normalized
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
    const fallback = id || `project-${Date.now().toString(36)}`;
    this.validateId(fallback);
    return fallback;
  }

  private validateId(id: string): void {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || id.includes("..")) {
      throw new ProjectManagerError("Project id is invalid");
    }
  }

  private async assertProjectPath(projectPath: string): Promise<void> {
    const relativePath = relative(this.projectsRoot, projectPath);
    if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
      throw new ProjectManagerError("Project path must stay inside projects directory");
    }

    try {
      const details = await lstat(projectPath);
      if (details.isSymbolicLink()) throw new ProjectManagerError("Project path cannot be a symlink");
      throw new ProjectManagerError("Project directory already exists", 409);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async assertStoredProject(project: Project): Promise<void> {
    const expectedDefault = resolve(this.defaultProject.path);
    const storedPath = resolve(project.path);

    // The default project must always live in projects/nexum.
    // Older versions could persist the repository root here, which made the
    // agent workspace point at the whole NEXUM repository and caused path
    // validation failures when the model used projects/nexum/... paths.
    if (project.id === this.defaultProject.id && storedPath !== expectedDefault) {
      const store = await this.requireStore();
      const stored = store.projects.find((item) => item.id === project.id);
      if (stored) {
        stored.path = expectedDefault;
        stored.updatedAt = new Date().toISOString();
        await this.writeStore(store);
      }
      project.path = expectedDefault;
      await assertExistingProjectPath(this.projectsRoot, relative(this.projectsRoot, expectedDefault));
      return;
    }

    await assertExistingProjectPath(this.projectsRoot, relative(this.projectsRoot, storedPath));
  }
}
