// my-task original code (not derived from upstream).
/**
 * 모든 소스 모듈의 오류가 이어받는 바탕. 오류 코드의 종류는 소스마다 다르므로 각 소스의 `errors.ts`가 좁힌다.
 * 앱은 이 바탕으로 어느 소스의 오류든 코드를 꺼낸다(메시지에는 값이나 내용을 넣지 않는다).
 */
export interface SourceErrorJSON {
  code: string;
  message: string;
  status?: number;
  retryAfterSeconds?: number;
}

export class SourceError<C extends string = string> extends Error {
  readonly code: C;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(code: C, message: string, extra: { status?: number; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = "SourceError";
    this.code = code;
    this.status = extra.status;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }

  toJSON(): SourceErrorJSON {
    const out: SourceErrorJSON = { code: this.code, message: this.message };
    if (this.status != null) out.status = this.status;
    if (this.retryAfterSeconds != null) out.retryAfterSeconds = this.retryAfterSeconds;
    return out;
  }
}
