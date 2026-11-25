import type { SandboxRequest, SandboxResult } from "./types.js";

export interface SandboxCreateRequest {
  projectPath: string;
  projectId?: string;
  taskId?: string;
}

export interface SandboxSession {
  run(request: SandboxRequest, signal?: AbortSignal): Promise<SandboxResult>;
  getPreviewUrl(port: number, expiresInSeconds?: number): Promise<string>;
  dispose(): Promise<void>;
}

export interface SandboxProvider {
  create(request: SandboxCreateRequest, signal?: AbortSignal): Promise<SandboxSession>;
}

export interface SandboxProviderSelection {
  provider?: string;
  nodeEnv?: string;
  docker?: SandboxProvider;
  daytona?: SandboxProvider;
}

/**
 * Production deliberately has no implicit local-execution fallback. A remote
 * provider must be configured explicitly before generated code can run.
 */
export function createSandboxProvider(options: SandboxProviderSelection): SandboxProvider {
  const configured = options.provider?.trim().toLowerCase();
  const isProduction = (options.nodeEnv ?? process.env.NODE_ENV) === "production";
  const selected = configured || (isProduction ? "" : "docker");

  if (selected === "docker") {
    if (isProduction) {
      throw new Error("Docker sandbox execution is disabled in production. Set NEXUM_SANDBOX_PROVIDER=daytona.");
    }
    if (!options.docker) throw new Error("Docker sandbox provider is not configured");
    return options.docker;
  }

  if (selected === "daytona") {
    if (!options.daytona) throw new Error("Daytona sandbox provider is not configured. Set DAYTONA_API_KEY.");
    return options.daytona;
  }

  if (!selected) {
    throw new Error("Production sandbox execution is not configured. Set NEXUM_SANDBOX_PROVIDER=daytona.");
  }
  throw new Error(`Unsupported sandbox provider: ${selected}`);
}
