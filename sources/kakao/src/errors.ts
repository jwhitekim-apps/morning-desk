// my-task original code (not derived from upstream).
import { SourceError } from "@morning-desk/shared";

/** 앱이 분기할 수 있는 안정적인 오류 분류. */
export type ErrorCode =
  | "auth_required"
  | "auth_expired"
  | "config_error"
  | "permission_denied"
  | "validation_error"
  | "rate_limited"
  | "unavailable"
  | "upstream_error"
  | "internal_error";

export class AppError extends SourceError<ErrorCode> {
  constructor(code: ErrorCode, message: string, extra: { status?: number; retryAfterSeconds?: number } = {}) {
    super(code, message, extra);
    this.name = "AppError";
  }
}

/** 예상하지 못한 예외도 내용(메시지 본문 등)이 새지 않도록 메시지를 그대로 쓰지 않고 분류만 남긴다. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal_error", "Unexpected internal error.");
}
