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
  readonly userSafeMessage: string;
  readonly requestId?: string;
  readonly projectId?: string;
  readonly agentRunId?: string;
  readonly stage?: string;

  constructor(
    code: NexumErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      technicalDetails?: string;
      userSafeMessage?: string;
      requestId?: string;
      projectId?: string;
      agentRunId?: string;
      stage?: string;
    } = {},
  ) {
    super(message);
    this.name = "NexumError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
    this.technicalDetails = options.technicalDetails;
    this.userSafeMessage = options.userSafeMessage ?? message;
    this.requestId = options.requestId;
    this.projectId = options.projectId;
    this.agentRunId = options.agentRunId;
    this.stage = options.stage;
  }
}

export function toNexumError(error: unknown, fallbackCode: NexumErrorCode = "INTERNAL_ERROR", fallbackMessage = "Внутренняя ошибка NEXUM."): NexumError {
  if (error instanceof NexumError) return error;
  const technicalDetails = error instanceof Error ? error.message : String(error);
  return new NexumError(fallbackCode, fallbackMessage, { technicalDetails });
}

export function classifyAIError(error: unknown): NexumError {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication failed|unauthorized|\b401\b|\b403\b/i.test(message)) {
    return new NexumError("AUTH_ERROR", "Проверьте настройки авторизации AI-провайдера.", { retryable: false, technicalDetails: message });
  }
  if (/rate limit|too many requests|\b429\b/i.test(message)) {
    return new NexumError("PROVIDER_ERROR", "AI-провайдер временно ограничил запросы. Повторите попытку позже.", { retryable: true, technicalDetails: message });
  }
  if (/timeout|timed out|network error|unavailable|fetch failed|econn/i.test(message)) {
    return new NexumError("NETWORK_ERROR", "Не удалось связаться с AI-провайдером. Проверьте соединение и повторите попытку.", { retryable: true, technicalDetails: message });
  }
  if (/invalid response|malformed|model/i.test(message)) {
    return new NexumError("MODEL_ERROR", "AI-модель вернула некорректный ответ.", { retryable: false, technicalDetails: message });
  }
  return new NexumError("PROVIDER_ERROR", "AI-провайдер не смог обработать запрос.", { retryable: false, technicalDetails: message });
}
