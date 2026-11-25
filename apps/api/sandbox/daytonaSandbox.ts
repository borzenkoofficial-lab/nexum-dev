import { Daytona } from "@daytona/sdk";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readdir, realpath, stat } from "node:fs/promises";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, isAbsolute, join, relative, resolve, sep, posix } from "node:path";
import { randomUUID } from "node:crypto";
import type { SandboxCreateRequest, SandboxProvider, SandboxSession } from "./provider.js";
import type { SandboxRequest, SandboxResult } from "./types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024;
const MAX_WORKSPACE_FILES = 1_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_WORKSPACE_BYTES = 200 * 1024 * 1024;
const BLOCKED_PATH_PARTS = new Set([
  ".git", "node_modules", ".next", ".nuxt", ".output", ".aws", ".azure", ".kube", ".docker",
  ".ssh", ".npmrc", ".pypirc", ".netrc", "coverage", ".cache", ".turbo", ".nexum",
]);
const STAGING_BUILD_OUTPUT_PARTS = new Set(["dist", "build"]);
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
  mode?: string;
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
    uploadFileStream(source: string, remotePath: string, options?: { signal?: AbortSignal; timeout?: number }): Promise<void>;
    listFiles(path: string, options?: { depth: number }): Promise<DaytonaFileInfo[]>;
    downloadFileStream(remotePath: string, options?: { signal?: AbortSignal; timeout?: number }): Promise<Readable>;
  };
  getWorkDir(): Promise<string>;
  setTtl(ttlMinutes: number): Promise<void>;
  setLabels(labels: Record<string, string>): Promise<Record<string, string>>;
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
  return new Daytona({ apiKey, requestTimeoutSeconds: 360 }) as unknown as DaytonaClientLike;
}

function isExcludedPath(relativePath: string, includeBuildArtifacts = false): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  const parts = normalized.split("/");
  const fileName = parts.at(-1)?.toLowerCase() ?? "";
  const sensitiveFile = /^(?:id_rsa|id_ed25519|id_ecdsa|credentials\.json|service-account(?:[-_].*)?\.json|\.dockerconfigjson)$/.test(fileName) ||
    /\.(?:pem|key|p12|pfx|jks|keystore)$/.test(fileName) ||
    fileName.endsWith(".secret") || fileName.endsWith(".token");
  return sensitiveFile || parts.some((part) =>
    BLOCKED_PATH_PARTS.has(part) ||
    (!includeBuildArtifacts && STAGING_BUILD_OUTPUT_PARTS.has(part)) ||
    part.startsWith(".env")
  );
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
  private disposePromise?: Promise<void>;

  constructor(
    private readonly sandbox: DaytonaSandboxLike,
    private readonly projectRoot: string,
    private readonly remoteRoot: string,
    private readonly sessionId: string,
    private readonly hasPackageJson: boolean,
  ) {}

  private dependenciesInstalled = false;

  async run(request: SandboxRequest, signal?: AbortSignal): Promise<SandboxResult> {
    const startedAt = Date.now();
    const command = request.command.trim();
    const base = { command, stdout: "", stderr: "", exitCode: null, durationMs: 0 };
    try {
      if (this.disposed) throw new Error("Daytona sandbox session is already disposed");
      if (signal?.aborted) throw abortError();
      validateCommand(command);
      const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`Sandbox timeout must be between 100 and ${MAX_TIMEOUT_MS} milliseconds`);
      }

      let bootstrapStdout = "";
      let bootstrapStderr = "";
      const isVersionCommand = command === "npm --version" || command === "npm -v" || command === "node --version" || command === "node -v";
      if (this.hasPackageJson && !this.dependenciesInstalled && command !== "npm install --ignore-scripts" && !isVersionCommand) {
        const install = await this.executeCommandWithAbort("npm install --ignore-scripts", 300, signal);
        bootstrapStdout = install.stdout ?? install.output ?? "";
        bootstrapStderr = install.stderr ?? "";
        if (install.exitCode !== 0) {
          await this.syncWorkspace(signal);
          return {
            ...base,
            success: false,
            exitCode: install.exitCode ?? 1,
            stdout: bounded(bootstrapStdout, MAX_OUTPUT_BYTES / 2),
            stderr: bounded(bootstrapStderr || "Dependency installation failed", MAX_OUTPUT_BYTES / 2),
            durationMs: Date.now() - startedAt,
            error: `Dependency installation failed with exit code ${install.exitCode ?? "unknown"}`,
          };
        }
        this.dependenciesInstalled = true;
        if (signal?.aborted) throw abortError();
        await this.syncWorkspace(signal);
      }

      if (command === "npm install --ignore-scripts") this.dependenciesInstalled = false;
      const commandTimeoutSeconds = command === "npm install --ignore-scripts" ? 300 : Math.max(1, Math.ceil(timeoutMs / 1000));
      const response = await this.executeCommandWithAbort(command, commandTimeoutSeconds, signal);
      if (command === "npm install --ignore-scripts" && response.exitCode === 0) this.dependenciesInstalled = true;
      const stdout = bounded([bootstrapStdout, response.stdout ?? response.output ?? ""].filter(Boolean).join("\n"), MAX_OUTPUT_BYTES / 2);
      const stderr = bounded([bootstrapStderr, response.stderr ?? ""].filter(Boolean).join("\n"), MAX_OUTPUT_BYTES / 2);
      const success = response.exitCode === 0;
      let syncError: string | undefined;
      if (!signal?.aborted) {
        try {
          await this.syncWorkspace(signal);
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
      if (signal?.aborted) void this.sandbox.stop().catch(() => undefined);
      const message = error instanceof Error ? error.message : "Daytona sandbox request failed";
      return {
        success: false,
        ...base,
        stderr: message,
        durationMs: Date.now() - startedAt,
        error: message,
      };
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
    if (!this.disposePromise) {
      this.disposed = true;
      // Concurrent job-finally and API-shutdown cleanup must await the same
      // remote deletion instead of allowing a second caller to return early.
      this.disposePromise = (async () => {
        await this.sandbox.process.deleteSession(this.sessionId).catch(() => undefined);
        await this.sandbox.delete(60, true);
      })();
    }
    await this.disposePromise;
  }

  private async executeCommandWithAbort(command: string, timeoutSeconds: number, signal?: AbortSignal) {
    if (signal?.aborted) throw abortError();
    const execution = this.sandbox.process.executeSessionCommand(
      this.sessionId,
      { command, runAsync: false, suppressInputEcho: true },
      timeoutSeconds,
    );
    if (!signal) return execution;

    let abortListener: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      abortListener = () => {
        void this.sandbox.stop().catch(() => undefined);
        reject(abortError());
      };
      signal.addEventListener("abort", abortListener, { once: true });
      if (signal.aborted) abortListener();
    });
    try {
      return await Promise.race([execution, aborted]);
    } finally {
      if (abortListener) signal.removeEventListener("abort", abortListener);
    }
  }
  private async syncWorkspace(signal?: AbortSignal): Promise<void> {
    const root = await realpath(this.projectRoot);
    let totalBytes = 0;
    let fileCount = 0;

    const walk = async (remoteDirectory: string): Promise<void> => {
      // List one level at a time so node_modules and other excluded trees are
      // never expanded into huge responses.
      const entries = await this.sandbox.fs.listFiles(remoteDirectory, { depth: 1 });
      for (const entry of entries) {
        if (signal?.aborted) throw abortError();
        if (entry.isSymlink || entry.mode?.startsWith("L")) continue;
        const listedPath = entry.path.replaceAll("\\", "/");
        let relativePath: string;
        if (listedPath.startsWith(this.remoteRoot + "/")) {
          relativePath = listedPath.slice(this.remoteRoot.length + 1);
        } else if (listedPath.startsWith("/")) {
          continue;
        } else {
          relativePath = listedPath;
        }
        relativePath = posix.normalize(relativePath);
        if (!relativePath || relativePath === "." || relativePath === ".." ||
            relativePath.startsWith("../") || relativePath.startsWith("/") || isExcludedPath(relativePath, true)) continue;

        const remoteFilePath = posix.join(this.remoteRoot, relativePath);
        if (entry.isDir || entry.isDirectory) {
          await walk(remoteFilePath);
          continue;
        }

        fileCount += 1;
        if (fileCount > MAX_WORKSPACE_FILES) throw new Error("Remote workspace exceeds the file synchronization limit");
        if (typeof entry.size === "number" && entry.size > MAX_FILE_BYTES) {
          throw new Error(`Remote workspace file exceeds the ${MAX_FILE_BYTES} byte synchronization limit: ${relativePath}`);
        }

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
        const stream = await this.sandbox.fs.downloadFileStream(remoteFilePath, { signal, timeout: 120 });
        let fileBytes = 0;
        const byteLimit = new Transform({
          transform(chunk: Buffer | string, _encoding, callback) {
            const chunkBytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(chunk);
            fileBytes += chunkBytes;
            totalBytes += chunkBytes;
            if (fileBytes > MAX_FILE_BYTES) {
              callback(new Error(`Remote workspace file exceeds the ${MAX_FILE_BYTES} byte synchronization limit: ${relativePath}`));
              return;
            }
            if (totalBytes > MAX_WORKSPACE_BYTES) {
              callback(new Error("Remote workspace exceeds the synchronization byte limit"));
              return;
            }
            callback(null, chunk);
          },
        });
        if (signal) await pipeline(stream, byteLimit, createWriteStream(localPath), { signal });
        else await pipeline(stream, byteLimit, createWriteStream(localPath));
      }
    };

    await walk(this.remoteRoot);
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
      domainAllowList: "registry.npmjs.org",
      resources: { cpu: this.cpu, memory: this.memoryGiB, disk: this.diskGiB },
      // Apply the hard lifetime in the create request itself. If the API
      // process exits immediately after provisioning, the sandbox still expires.
      ttlMinutes: this.ttlMinutes,
    }, { timeout: 90 });

    try {
      await sandbox.setLabels({ app: "nexum-builder", task: taskLabel });
      if (signal?.aborted) throw abortError();
      const workDir = (await sandbox.getWorkDir()).replaceAll("\\", "/");
      const remoteRoot = posix.join(workDir, "nexum-project");
      await createRemoteDirectories(sandbox, remoteRoot, files);
      for (let offset = 0; offset < files.length; offset += 10) {
        if (signal?.aborted) throw abortError();
        const batch = files.slice(offset, offset + 10);
        await Promise.all(batch.map((file) => sandbox.fs.uploadFileStream(
          file.absolutePath,
          posix.join(remoteRoot, file.relativePath),
          { signal, timeout: 300 },
        )));
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
      return new DaytonaSandboxSession(sandbox, projectRoot, remoteRoot, sessionId, files.some((file) => file.relativePath === "package.json"));
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
