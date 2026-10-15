// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import type { Logger } from "@morning-desk/shared";

export type FetchFn = typeof fetch;

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** 모델 호출의 추상. 실제 구현은 `LlmClient`, 테스트는 가짜로 바꾼다. */
export interface Model {
  /** 대화를 보내고 모델의 글(JSON이어야 함)을 돌려준다. */
  complete(messages: ChatMessage[]): Promise<string>;
}

export interface LlmConfig {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  model: string;
  /** 첫 호출의 제한 시간(모델이 메모리에 올라오는 시간 포함). */
  firstCallTimeoutMs: number;
  /** 이후 호출(다시 요청 등)의 제한 시간. */
  timeoutMs: number;
  /** 평문(http) 주소로 내용을 보내는 것을 허용한다. 시험용이며 본운영에서는 켜지 않는다. */
  allowPlaintext: boolean;
}

/** `<think>...</think>`처럼 생각을 글에 섞어 내는 모델을 위해 걷어 낸다. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/** OpenAI 호환 `/chat/completions`를 부르는 클라이언트. 키와 내용은 로그에 남기지 않는다. */
export class LlmClient implements Model {
  private calls = 0;
  private readonly fetchFn: FetchFn;

  constructor(private readonly config: LlmConfig, private readonly logger: Logger, fetchFn?: FetchFn) {
    this.fetchFn = fetchFn ?? fetch;
  }

  private endpoint(): URL {
    const { baseUrl, apiKey, allowPlaintext } = this.config;
    if (!baseUrl || !apiKey) throw new AppError("config_error", "LOCAL_LLM_BASE_URL and LOCAL_LLM_API_KEY must be set.");
    let url: URL;
    try {
      url = new URL(`${baseUrl.replace(/\/+$/, "")}/chat/completions`);
    } catch {
      throw new AppError("config_error", "LOCAL_LLM_BASE_URL is not a valid URL.");
    }
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !local && !allowPlaintext) {
      // 메일·이슈 내용과 키가 평문으로 나가므로 막는다(시험은 LLM_ALLOW_PLAINTEXT=1로 의식적으로 허용).
      throw new AppError("config_error", "The model address must use https: mail and task content is sent to it. (For tests only: LLM_ALLOW_PLAINTEXT=1.)");
    }
    return url;
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const url = this.endpoint();
    const first = this.calls++ === 0;
    const timeoutMs = first ? this.config.firstCallTimeoutMs : this.config.timeoutMs;
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({ model: this.config.model, messages, temperature: 0, stream: false, response_format: { type: "json_object" } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      this.logger.warn("model call failed", { op: "model", durationMs: Date.now() - startedAt, errorCode: timedOut ? "timeout" : "model_error" });
      throw new AppError(timedOut ? "timeout" : "model_error", timedOut ? `The model did not answer within ${Math.round(timeoutMs / 1000)}s.` : "Could not reach the model server.");
    }
    this.logger.info("model call", { op: "model", status: res.status, durationMs: Date.now() - startedAt, attempt: first ? 0 : 1 });
    if (!res.ok) {
      throw new AppError("model_error", res.status === 401 || res.status === 403 ? "The model server rejected the key." : `The model server returned an error (HTTP ${res.status}).`);
    }
    let content: unknown;
    try {
      content = ((await res.json()) as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content;
    } catch {
      throw new AppError("model_error", "The model server's answer was not JSON.");
    }
    if (typeof content !== "string" || content.trim() === "") throw new AppError("model_error", "The model returned an empty answer.");
    return stripThinking(content);
  }
}
