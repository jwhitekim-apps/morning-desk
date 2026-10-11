// my-task original code (not derived from upstream).
/** 호출하는 쪽(과 LLM)이 분기할 수 있는 안정적인 오류 분류. */
export type ErrorCode =
  | "config_error"
  | "auth_failed"
  | "permission_denied"
  | "not_found"
  | "validation_error"
  | "rate_limited"
  | "unavailable"
  | "upstream_error"
  | "internal_error";

export interface AppErrorJSON {
  code: ErrorCode;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
  /** 요청 한도가 풀려 다시 시도할 수 있는 시각(한국 시간, ISO 8601). */
  retryAt?: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;
  readonly retryAt?: string;

  constructor(code: ErrorCode, message: string, extra: { status?: number; retryAfterSeconds?: number; retryAt?: string } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = extra.status;
    this.retryAfterSeconds = extra.retryAfterSeconds;
    this.retryAt = extra.retryAt;
  }

  toJSON(): AppErrorJSON {
    const out: AppErrorJSON = { code: this.code, message: this.message };
    if (this.status != null) out.status = this.status;
    if (this.retryAfterSeconds != null) out.retryAfterSeconds = this.retryAfterSeconds;
    if (this.retryAt != null) out.retryAt = this.retryAt;
    return out;
  }
}

/** 예상하지 못한 예외도 토큰이나 내용이 새지 않도록 메시지를 그대로 쓰지 않고 분류만 남긴다. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal_error", "Unexpected internal error.");
}
