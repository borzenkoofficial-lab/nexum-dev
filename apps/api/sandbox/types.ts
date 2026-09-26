export interface SandboxRequest {
  projectPath: string;
  command: string;
  timeoutMs?: number;
}

export interface SandboxResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  command: string;
  error?: string;
}
