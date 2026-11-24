import { Daytona } from "@daytona/sdk";
import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { randomUUID } from "node:crypto";
import type { SandboxCreateRequest, SandboxProvider, SandboxSession } from "./provider.js";
import type { SandboxRequest, SandboxResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_WORKSPACE_FILES = 1_000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 100 * 1024 * 1024;
const BLOCKED_PATH_PARTS = new Set([
  ".git", "node_modules", "dist", "build", ".next", ".nuxt", ".output", ".aws", ".ssh", ".npmrc", ".pypirc", ".netrc",
  "coverage", ".cache", ".turbo", ".nexum",
]);
const SHELL_SYNTAX = /[;&|`$()<>\n\r\\]/;
const ALLOWED_NPM_SCRIPTS = new Set(["build", "test", "lint", "typecheck"]);
const ALLOWED_NPX_COMMANDS = new Set(["tsc", "vite", "oxlint"]);

export interface WorkspaceFile {
  relativePath: string;
  absolutePath: string;
  size: number;
}

export interface DaytonaFileInfo {
  path: string;
  name?: string;
  size?: number;
  isDir?: boolean;
  isDirectory?: boolean;
  isSymlink?: boolean;
}

export interface DaytonaSandboxLike {
  id: string;
  process: {
    createSession(sessionId: string): Promise<void>;
    executeSessionCommand(sessionId: string, request: {
      command: string;
      runAsync?: boolean;
      suppressInputEcho?: boolean;
    }, timeout?: number): Promise<{
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      output?: string;
    }>;
    deleteSession(sessionId: string): Promise<void>;
  };
  fs: {
    createFolder(path: string, mode: string): Promise<void>;
    uploadFiles(files: Array<{ source: string; destination: string }>, timeout?: number): Promise<void>;
    listFiles(path: string, options?: { depth: number }): Promise<DaytonaFileInfo[]>;
    downloadFile(remotePath: string, localPath: string, timeout?: number): Promise<void>;
  };
  getWorkDir(): Promise<string>;
  setTtl(ttlMinutes: number): Promise<void>;
  setLabels(labels: Record<string, string>): Promise<Record<string, string>>;
  updateNetworkSettings(settings: { networkBlockAll?: boolean; domainAllowList?: string }): Promise<void>;
  getSignedPreviewUrl(port: number, expiresInSeconds?: number): Promise<{ url: string }>;
  stop(): Promise<void>;
  delete(timeout?: number, wait?: boolean): Promise<void>;
}

export interface DaytonaClientLike {
  v0: {
    create(options: Record<string, unknown>, operationOptions?: { timeout?: number }): Promise<DaytonaSandboxLike>;
  };
}

export interface DaytonaSandboxProviderOptions {
  apiKey?: string;
  client?: DaytonaClientLike;
  cpu?: number;
  memoryGiB?: number;
  diskGiB?: number;
  ttlMinutes?: number;
}

function createSdkClient(apiKey: string): DaytonaClientLike {
  return new Daytona({ apiKey, requestTimeoutSeconds: 150 }) as unknown as DaytonaClientLike;
}

function isExcludedPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  return parts.some((part) => BLOCKED_PATH_PARTS.has(part) || part.startsWith(".env"));
}

function assertInside(root: string, target: string): void {
  const path = resolve(target);
  const rel = relative(root, path);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("Workspace transfer path escaped the project root");
  }
}

export async function collectWorkspaceFiles(projectRoot: string): Promise<WorkspaceFile[]> {
  const root = await realpath(projectRoot);
  const rootDetails = await stat(root);
  if (!rootDetails.isDirectory()) throw new Error("Daytona projectPath must be a directory");

  const files: WorkspaceFile[] = [];
  let totalBytes = 0;

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const relativePath = relative(root, absolutePath).split(sep).join("/");
      if (isExcludedPath(relativePath)) continue;

      const details = await lstat(absolutePath);
      // Symlinks are deliberately not followed: a project must not upload
      // files outside its root or smuggle host paths into the remote sandbox.
      if (details.isSymbolicLink()) continue;
      if (details.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!details.isFile()) continue;
      if (details.size > MAX_FILE_BYTES) {
        throw new Error(`Workspace file exceeds the ${MAX_FILE_BYTES} byte transfer limit: ${relativePath}`);
      }
      totalBytes += details.size;
      if (totalBytes > MAX_WORKSPACE_BYTES) {
        throw new Error(`Workspace exceeds the ${MAX_WORKSPACE_BYTES} byte transfer limit`);
      }
      files.push({ relativePath, absolutePath, size: details.size });
      if (files.length > MAX_WORKSPACE_FILES) {
        throw new Error(`Workspace exceeds the ${MAX_WORKSPACE_FILES} file transfer limit`);
      }
    }
  };

  await walk(root);
  return files;
}

async function createRemoteDirectories(sandbox: DaytonaSandboxLike, remoteRoot: string, files: WorkspaceFile[]): Promise<void> {
  const directories = new Set<string>([remoteRoot]);
  for (const file of files) {
    let current = dirname(posix.join(remoteRoot, file.relativePath));
    while (current !== remoteRoot && current !== ".") {
      directories.add(current);
      current = posix.dirname(current);
    }
  }
  for (const directory of [...directories].sort((a, b) => a.length - b.length)) {
    await sandbox.fs.createFolder(directory, "755");
  }
}

function validateCommand(command: string): void {
  const input = command.trim();
  if (!input || SHELL_SYNTAX.test(input)) {
    throw new Error("Daytona command is empty or contains shell operators");
  }
  const [executable, ...args] = input.split(/\s+/);
  if (executable === "npm") {
    if (args[0] === "install" && args.length === 2 && args[1] === "--ignore-scripts") return;
    if ((args[0] === "run" && (!args[1] || ALLOWED_NPM_SCRIPTS.has(args[1]))) ||
        args[0] === "--version" || args[0] === "-v") return;
    throw new Error("Only npm install --ignore-scripts and allowlisted npm run scripts are allowed");
  }
  if (executable === "npx") {
    const packageName = args.find((argument) => !argument.startsWith("-"));
    if (packageName && ALLOWED_NPX_COMMANDS.has(packageName) &&
        !args.some((argument) => ["--yes", "--package", "--shell"].includes(argument))) return;
    throw new Error("Only npx tsc, npx vite and npx oxlint are allowed");
  }
  if (executable === "node") {
    if (args[0] === "--version" || args[0] === "-v") return;
    if (!args[0] || args[0].startsWith("-") || args.some((argument) => ["-e", "--eval", "-p", "--print"].includes(argument)) ||
        args[0].split("/").includes("..") || isAbsolute(args[0])) {
      throw new Error("Only project-relative Node script files are allowed");
    }
    return;
  }
  throw new Error("Daytona command is not allowlisted");
}

function bounded(value: string, maxBytes = MAX_OUTPUT_BYTES): string {
  const buffer = Buffer.from(value, "utf8");
  if (buffer.byteLength <= maxBytes) return value;
  return buffer.subarray(0, maxBytes).toString("utf8") + "\n[output truncated]";
}

function abortError(): Error {
  const error = new Error("Sandbox command cancelled");
  error.name = "AbortError";
  return error;
}

class DaytonaSandboxSession implements SandboxSession {
  private disposed = false;

  constructor(
    private readonly sandbox: DaytonaSandboxLike,
    private readonly projectRoot: string,
    private readonly remoteRoot: string,
    private readonly sessionId: string,
  ) {}

  async run(request: SandboxRequest, signal?: AbortSignal): Promise<SandboxResult> {
    const startedAt = Date.now();
    const command = request.command.trim();
    const base = { command, stdout: "", stderr: "", exitCode: null, durationMs: 0 };
    let networkChanged = false;
    try {
      if (this.disposed) throw new Error("Daytona sandbox session is already disposed");
      if (signal?.aborted) throw abortError();
      validateCommand(command);
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`Sandbox timeout must be between 100 and ${MAX_TIMEOUT_MS} milliseconds`);
      }

      if (command === "npm install --ignore-scripts") {
        await this.sandbox.updateNetworkSettings({ networkBlockAll: false, domainAllowList: "registry.npmjs.org" });
        networkChanged = true;
      }
      if (signal?.aborted) throw abortError();

      const execution = this.sandbox.process.executeSessionCommand(
        this.sessionId,
        { command, runAsync: false, suppressInputEcho: true },
        Math.max(1, Math.ceil(timeoutMs / 1000)),
      );
      let abortListener: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        if (!signal) return;
        abortListener = () => {
          void this.sandbox.stop().catch(() => undefined);
          reject(abortError());
        };
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) abortListener();
      });

      let response: Awaited<typeof execution>;
      try {
        response = signal ? await Promise.race([execution, aborted]) : await execution;
      } finally {
        if (abortListener) signal?.removeEventListener("abort", abortListener);
      }

      const stdout = bounded(response.stdout ?? response.output ?? "", MAX_OUTPUT_BYTES / 2);
      const stderr = bounded(response.stderr ?? "", MAX_OUTPUT_BYTES / 2);
      const success = response.exitCode === 0;
      let syncError: string | undefined;
      if (!signal?.aborted) {
        try {
          await this.syncWorkspace();
        } catch (error) {
          syncError = error instanceof Error ? error.message : "Workspace synchronization failed";
        }
      }
      const error = syncError ?? (!success ? (stderr.trim().slice(-2000) || `Sandbox command exited with code ${response.exitCode}`) : undefined);
      return {
        ...base,
        success: success && !syncError,
        exitCode: response.exitCode ?? null,
        stdout,
        stderr: syncError ? bounded(`${stderr}\n${syncError}`) : stderr,
        durationMs: Date.now() - startedAt,
        ...(error ? { error } : {}),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Daytona sandbox request failed";
      return {
        success: false,
        ...base,
        stderr: message,
        durationMs: Date.now() - startedAt,
        error: message,
      };
    } finally {
      if (networkChanged) {
        try {
          await this.sandbox.updateNetworkSettings({ networkBlockAll: true });
        } catch (error) {
          this.disposed = true;
          console.error("[Nexum] Failed to re-block Daytona sandbox network; destroying sandbox", {
            sandboxId: this.sandbox.id,
            error: error instanceof Error ? error.message : String(error),
          });
          await this.sandbox.stop().catch(() => undefined);
          await this.sandbox.delete(60, true).catch(() => undefined);
          throw new Error("Daytona network isolation could not be restored; the sandbox was stopped and deleted.");
        }
      }
    }
  }

  async getPreviewUrl(port: number, expiresInSeconds = 120): Promise<string> {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Preview port is invalid");
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 30 || expiresInSeconds > 600) {
      throw new Error("Preview URL expiry must be between 30 and 600 seconds");
    }
    const preview = await this.sandbox.getSignedPreviewUrl(port, expiresInSeconds);
    return preview.url;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.sandbox.process.deleteSession(this.sessionId).catch(() => undefined);
    await this.sandbox.delete(60, true);
  }

  private async syncWorkspace(): Promise<void> {
    const entries = await this.sandbox.fs.listFiles(this.remoteRoot, { depth: 50 });
    if (entries.length > MAX_WORKSPACE_FILES) throw new Error("Remote workspace exceeds the file synchronization limit");
    const root = await realpath(this.projectRoot);
    let totalBytes = 0;
    for (const entry of entries) {
      if (entry.isDir || entry.isDirectory || entry.isSymlink) continue;
      const listedPath = entry.path.replaceAll("\\", "/");
      let relativePath: string;
      if (listedPath.startsWith(this.remoteRoot + "/")) {
        relativePath = listedPath.slice(this.remoteRoot.length + 1);
      } else if (listedPath.startsWith("/")) {
        // Do not let an unexpected absolute path escape the staged workspace.
        continue;
      } else {
        relativePath = listedPath;
      }
      relativePath = posix.normalize(relativePath);
      if (!relativePath || relativePath === "." || relativePath === ".." ||
          relativePath.startsWith("../") || relativePath.startsWith("/") || isExcludedPath(relativePath)) continue;
      if (typeof entry.size === "number") {
        if (entry.size > MAX_FILE_BYTES) continue;
        totalBytes += entry.size;
        if (totalBytes > MAX_WORKSPACE_BYTES) throw new Error("Remote workspace exceeds the synchronization byte limit");
      }
      const remoteFilePath = posix.join(this.remoteRoot, relativePath);
      const localPath = resolve(root, ...relativePath.split("/"));
      assertInside(root, localPath);
      await mkdir(dirname(localPath), { recursive: true });
      const parent = await realpath(dirname(localPath));
      assertInside(root, parent);
      try {
        const existing = await lstat(localPath);
        if (existing.isSymbolicLink() || existing.isDirectory()) continue;
      } catch {
        // A new generated file is expected.
      }
      await this.sandbox.fs.downloadFile(remoteFilePath, localPath, 120);
    }
  }
}

export class DaytonaSandboxProvider implements SandboxProvider {
  private readonly apiKey: string;
  private readonly client: DaytonaClientLike;
  private readonly cpu: number;
  private readonly memoryGiB: number;
  private readonly diskGiB: number;
  private readonly ttlMinutes: number;

  constructor(options: DaytonaSandboxProviderOptions = {}) {
    this.apiKey = options.apiKey ?? process.env.DAYTONA_API_KEY ?? "";
    if (!this.apiKey.trim()) throw new Error("DAYTONA_API_KEY is required for the Daytona sandbox provider");
    this.client = options.client ?? createSdkClient(this.apiKey);
    this.cpu = options.cpu ?? 2;
    this.memoryGiB = options.memoryGiB ?? 4;
    this.diskGiB = options.diskGiB ?? 10;
    this.ttlMinutes = options.ttlMinutes ?? 30;
  }

  async create(request: SandboxCreateRequest, signal?: AbortSignal): Promise<SandboxSession> {
    if (signal?.aborted) throw abortError();
    const projectRoot = await realpath(request.projectPath);
    const files = await collectWorkspaceFiles(projectRoot);
    const taskLabel = (request.taskId ?? randomUUID()).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 48) || randomUUID();
    const sandbox = await this.client.v0.create({
      image: "node:22-bookworm-slim",
      public: false,
      networkBlockAll: true,
      resources: { cpu: this.cpu, memory: this.memoryGiB, disk: this.diskGiB },
    }, { timeout: 90 });

    try {
      await sandbox.setTtl(this.ttlMinutes);
      await sandbox.setLabels({ app: "nexum-builder", task: taskLabel });
      if (signal?.aborted) throw abortError();
      const workDir = (await sandbox.getWorkDir()).replaceAll("\\", "/");
      const remoteRoot = posix.join(workDir, "nexum-project");
      await createRemoteDirectories(sandbox, remoteRoot, files);
      if (files.length) {
        await sandbox.fs.uploadFiles(
          files.map((file) => ({
            source: file.absolutePath,
            destination: posix.join(remoteRoot, file.relativePath),
          })),
          300,
        );
      }
      if (signal?.aborted) throw abortError();
      const sessionId = `nexum-${randomUUID()}`;
      await sandbox.process.createSession(sessionId);
      const changedDirectory = await sandbox.process.executeSessionCommand(
        sessionId,
        { command: `cd "${remoteRoot}"`, runAsync: false, suppressInputEcho: true },
        30,
      );
      if (changedDirectory.exitCode !== 0) {
        throw new Error("Could not set the Daytona command working directory");
      }
      return new DaytonaSandboxSession(sandbox, projectRoot, remoteRoot, sessionId);
    } catch (error) {
      await sandbox.delete(60, true).catch((cleanupError) => {
        console.error("[Nexum] Failed to clean up Daytona sandbox after provisioning error", {
          sandboxId: sandbox.id,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      });
      throw error;
    }
  }
}
