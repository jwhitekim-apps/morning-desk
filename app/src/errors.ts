// my-task original code (not derived from upstream).
/** 호출하는 쪽이 분기할 수 있는 안정적인 오류 분류. */
export type ErrorCode =
  | "config_error"
  /** MCP 서버를 띄우지 못했거나 연결이 끊겼다. */
  | "server_unavailable"
  /** MCP 도구가 오류를 돌려줬다(코드는 `toolCode`). */
  | "tool_error"
  | "timeout"
  | "validation_error"
  | "model_error"
  | "internal_error";

export class AppError extends Error {
  readonly code: ErrorCode;
  /** `tool_error`일 때 서버가 돌려준 오류 코드(예: `auth_expired`). */
  readonly toolCode?: string;

  constructor(code: ErrorCode, message: string, extra: { toolCode?: string } = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.toolCode = extra.toolCode;
  }
}

/** 예상하지 못한 예외도 내용(메일 제목 등)이 새지 않도록 메시지를 그대로 쓰지 않고 분류만 남긴다. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal_error", "Unexpected internal error.");
}
