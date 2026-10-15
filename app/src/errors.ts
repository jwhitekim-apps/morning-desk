// my-task original code (not derived from upstream).
/**
 * 앱 자신의 오류 분류. 소스 모듈의 오류는 각 모듈의 코드(`SourceError` 바탕)를 그대로 쓴다.
 */
export type ErrorCode =
  | "config_error"
  /** 소스 호출이나 모델 호출이 제한 시간 안에 끝나지 않았다. */
  | "timeout"
  | "validation_error"
  | "model_error"
  | "internal_error";

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}

/** 예상하지 못한 예외도 내용(메일 제목 등)이 새지 않도록 메시지를 그대로 쓰지 않고 분류만 남긴다. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal_error", "Unexpected internal error.");
}
