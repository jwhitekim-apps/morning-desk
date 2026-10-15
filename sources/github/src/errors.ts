// my-task original code (not derived from upstream).
import { SourceError, type SourceErrorJSON } from "@morning-desk/shared";

/** 앱이 분기할 수 있는 안정적인 오류 분류. */
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

export interface AppErrorJSON extends SourceErrorJSON {
  code: ErrorCode;
  /** 요청 한도가 풀려 다시 시도할 수 있는 시각(한국 시간, ISO 8601). */
  retryAt?: string;
}

export class AppError extends SourceError<ErrorCode> {
  readonly retryAt?: string;

  constructor(code: ErrorCode, message: string, extra: { status?: number; retryAfterSeconds?: number; retryAt?: string } = {}) {
    super(code, message, extra);
    this.name = "AppError";
    this.retryAt = extra.retryAt;
  }

  override toJSON(): AppErrorJSON {
    const out: AppErrorJSON = { ...super.toJSON(), code: this.code };
    if (this.retryAt != null) out.retryAt = this.retryAt;
    return out;
  }
}

/** 예상하지 못한 예외도 토큰이나 내용이 새지 않도록 메시지를 그대로 쓰지 않고 분류만 남긴다. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal_error", "Unexpected internal error.");
}
