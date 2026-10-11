// my-task original code (not derived from upstream).
/** 호출하는 쪽(과 LLM)이 분기할 수 있는 안정적인 오류 분류. */
export type ErrorCode =
  /** 점검할 대상이 하나도 설정되어 있지 않다. */
  | "config_missing"
  /** 설정 파일이 잘못되었다(형식, 이름 모양, 주소). */
  | "config_error"
  /** 도구 입력이 잘못되었다(설정에 없는 이름, 상한을 넘는 값). */
  | "validation_error"
  /** 이쪽 사정으로 점검하지 못했다(도커 없음, 권한 없음). */
  | "check_unavailable"
  | "internal_error";

export interface AppErrorJSON {
  code: ErrorCode;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }

  toJSON(): AppErrorJSON {
    return { code: this.code, message: this.message };
  }
}

/** 예상하지 못한 예외도 키나 로그 내용이 새지 않도록 메시지를 그대로 쓰지 않고 분류만 남긴다. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  return new AppError("internal_error", "Unexpected internal error.");
}
