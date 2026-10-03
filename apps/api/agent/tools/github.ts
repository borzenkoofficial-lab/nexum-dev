import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Tool, ToolResult } from "../types.js";

export type GitHubOperation =
  | "repository"
  | "branches"
  | "commits"
  | "commit"
  | "issues"
  | "issue"
  | "pullRequests"
  | "pullRequest";

export interface GitHubToolResult extends ToolResult {
  success: boolean;
  operation: GitHubOperation | string;
  data?: unknown;
  githubError?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const GITHUB_API_ORIGIN = "https://api.github.com";
const GITHUB_TOKEN_ERROR = "GITHUB_TOKEN is not configured";

type GitHubRequest = {
  operation: GitHubOperation | string;
  identifier?: string;
};

export class GitHubTool implements Tool {
  name = "github";
  description = "Reads repository information from the GitHub REST API";

  constructor(
    private readonly projectRoot: string,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async execute(input: string, signal?: AbortSignal): Promise<GitHubToolResult> {
    const request = this.parseRequest(input);
    const token = process.env.GITHUB_TOKEN?.trim();

    if (!token) {
      this.logUnknown(request.operation, false, "not-requested");
      return this.failure(request.operation, GITHUB_TOKEN_ERROR);
    }

    if (!this.isSupportedOperation(request.operation)) {
      this.logUnknown(request.operation, false, "not-requested");
      return this.failure(request.operation, "GitHub operation is not allowed");
    }

    try {
      const repository = await this.findRepository();
      const path = this.buildPath(repository, request);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const abortFromCaller = () => controller.abort(signal?.reason);
      if (signal) { if (signal.aborted) abortFromCaller(); else signal.addEventListener("abort", abortFromCaller, { once: true }); }
      let response: Response;

      try {
        response = await this.fetchImpl(`${GITHUB_API_ORIGIN}${path}`, {
          method: "GET",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "NEXUM.DEV-Agent",
          },
          signal: controller.signal,
        });
      } catch (error) {
        const message = signal?.aborted
          ? "GitHub request cancelled"
          : controller.signal.aborted
            ? "GitHub request timed out"
          : "GitHub network error";
        this.log(request.operation, repository, null, false);
        return this.failure(request.operation, message);
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener("abort", abortFromCaller);
      }

      this.log(request.operation, repository, response.status, response.ok);

      if (!response.ok) {
        return this.failure(request.operation, this.httpError(response.status));
      }

      let data = await response.json();
      if (request.operation === "issues" && Array.isArray(data)) {
        data = data.filter((item) => !item || typeof item !== "object" || !("pull_request" in item));
      }
      return this.success(request.operation, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub request failed";
      this.logUnknown(request.operation, false, "not-requested");
      return this.failure(request.operation, message);
    }
  }

  private parseRequest(input: string): GitHubRequest {
    const [operation, identifier] = input.trim().split(":", 2);
    const allowedOperations = new Set<GitHubOperation>([
      "repository",
      "branches",
      "commits",
      "commit",
      "issues",
      "issue",
      "pullRequests",
      "pullRequest",
    ]);

    if (!operation || !allowedOperations.has(operation as GitHubOperation)) {
      return { operation: input.trim() };
    }

    return {
      operation: operation as GitHubOperation,
      ...(identifier ? { identifier } : {}),
    };
  }

  private async findRepository(): Promise<{ owner: string; name: string; fullName: string }> {
    const gitDirectory = resolve(this.projectRoot, ".git");
    const configPath = resolve(gitDirectory, "config");
    const config = await readFile(configPath, "utf8");
    const originSection = config.match(/\[remote\s+"origin"\]([\s\S]*?)(?=\n\[|$)/i)?.[1] ?? "";
    const remoteUrl = originSection.match(/^\s*url\s*=\s*(\S+)\s*$/m)?.[1];

    if (!remoteUrl) {
      throw new Error("GitHub origin remote is not configured");
    }

    const repository = this.parseGitHubRemote(remoteUrl);
    if (!repository) {
      throw new Error("Git origin is not a GitHub repository");
    }

    return repository;
  }

  private parseGitHubRemote(remoteUrl: string): { owner: string; name: string; fullName: string } | null {
    const match = remoteUrl.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
    if (!match?.[1] || !match[2] || !/^[A-Za-z0-9_.-]+$/.test(match[1]) || !/^[A-Za-z0-9_.-]+$/.test(match[2])) {
      return null;
    }

    return {
      owner: match[1],
      name: match[2],
      fullName: `${match[1]}/${match[2]}`,
    };
  }

  private buildPath(
    repository: { owner: string; name: string },
    request: GitHubRequest,
  ): string {
    const base = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
    const identifier = request.identifier;

    switch (request.operation) {
      case "repository":
        return base;
      case "branches":
        return `${base}/branches?per_page=100`;
      case "commits":
        return `${base}/commits?per_page=20`;
      case "commit":
        return `${base}/commits/${this.requireIdentifier(identifier)}`;
      case "issues":
        return `${base}/issues?state=all&per_page=20`;
      case "issue":
        return `${base}/issues/${this.requireNumber(identifier)}`;
      case "pullRequests":
        return `${base}/pulls?state=all&per_page=20`;
      case "pullRequest":
        return `${base}/pulls/${this.requireNumber(identifier)}`;
      default:
        throw new Error("GitHub operation is not allowed");
    }
  }

  private isSupportedOperation(operation: string): operation is GitHubOperation {
    return [
      "repository",
      "branches",
      "commits",
      "commit",
      "issues",
      "issue",
      "pullRequests",
      "pullRequest",
    ].includes(operation);
  }

  private requireIdentifier(identifier: string | undefined): string {
    if (!identifier || !/^[A-Za-z0-9._-]+$/.test(identifier)) {
      throw new Error("GitHub commit identifier is invalid");
    }
    return encodeURIComponent(identifier);
  }

  private requireNumber(identifier: string | undefined): string {
    if (!identifier || !/^\d+$/.test(identifier)) {
      throw new Error("GitHub issue or pull request number is invalid");
    }
    return identifier;
  }

  private httpError(status: number): string {
    if (status === 401) return "GitHub authentication failed (401)";
    if (status === 403) return "GitHub access forbidden or rate limit exceeded (403)";
    if (status === 404) return "GitHub repository or resource was not found (404)";
    if (status === 429) return "GitHub rate limit exceeded (429)";
    return `GitHub API request failed (${status})`;
  }

  private success(operation: string, data: unknown): GitHubToolResult {
    return {
      success: true,
      operation,
      data,
      output: JSON.stringify({ success: true, operation, data }),
    };
  }

  private failure(operation: string, error: string): GitHubToolResult {
    const lower = error.toLowerCase();
    const code = /authentication|forbidden|permission/.test(lower)
      ? "PERMISSION_ERROR"
      : /rate limit|429|timed out|network/.test(lower)
        ? "NETWORK_ERROR"
        : "TOOL_ERROR";
    const retryable = code === "NETWORK_ERROR" && !/authentication|permission|forbidden/.test(lower);
    return {
      success: false,
      operation,
      githubError: error,
      error: { code, message: error, retryable, repairable: !retryable, fatal: code === "PERMISSION_ERROR" },
      output: JSON.stringify({ success: false, operation, error: { code, message: error, retryable } }),
    };
  }

  private log(
    operation: string,
    repository: { fullName: string },
    status: number | null,
    success: boolean,
  ): void {
    console.log(
      `[agent] github operation: ${operation}; repository: ${repository.fullName}; result: ${success ? "success" : "failed"}; HTTP status: ${status ?? "network-error"}`,
    );
  }

  private logUnknown(operation: string, success: boolean, status: string): void {
    console.log(
      `[agent] github operation: ${operation}; repository: unknown; result: ${success ? "success" : "failed"}; HTTP status: ${status}`,
    );
  }
}
