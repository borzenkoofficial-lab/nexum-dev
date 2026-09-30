export type NexumErrorCode =
  | "USER_ERROR"
  | "MODEL_ERROR"
  | "PROVIDER_ERROR"
  | "TOOL_ERROR"
  | "BUILD_ERROR"
  | "RUNTIME_ERROR"
  | "NETWORK_ERROR"
  | "AUTH_ERROR"
  | "CONFIG_ERROR"
  | "INTERNAL_ERROR";

export class NexumError extends Error {
  readonly code: NexumErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly technicalDetails?: string;

  constructor(
    code: NexumErrorCode,
    message: string,
    options: { retryable?: boolean; status?: number; technicalDetails?: string } = {},
  ) {
    super(message);
    this.name = "NexumError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.technicalDetails = options.technicalDetails;
  }
}

export function classifyAIError(error: unknown): NexumError {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication failed|unauthorized|\b401\b|\b403\b/i.test(message)) {
    return new NexumError("AUTH_ERROR", message, { retryable: false, technicalDetails: message });
  }
  if (/rate limit|too many requests|\b429\b/i.test(message)) {
    return new NexumError("PROVIDER_ERROR", message, { retryable: true, technicalDetails: message });
  }
  if (/timeout|timed out|network error|unavailable|fetch failed|econn/i.test(message)) {
    return new NexumError("NETWORK_ERROR", message, { retryable: true, technicalDetails: message });
  }
  if (/invalid response|malformed|model/i.test(message)) {
    return new NexumError("MODEL_ERROR", message, { retryable: false, technicalDetails: message });
  }
  return new NexumError("PROVIDER_ERROR", message, { retryable: false, technicalDetails: message });
}
