// my-task original code (not derived from upstream).
import type { FetchFn } from "../auth/provider";
import { AppError } from "../errors";
import type { Logger } from "../logger";

const MEMO_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";
/** 카카오 텍스트 템플릿 본문 한도(글자 수). */
export const TEXT_LIMIT = 200;
/** 한 번에 보낼 수 있는 통수. */
export const MAX_BATCH = 3;

export interface KakaoApiOptions {
  linkUrl: string | undefined;
  /** 켜져 있으면 호출 쪽이 무엇을 요청하든 드라이런이다. */
  dryRunAll: boolean;
  fetchFn?: FetchFn;
}

export interface SendResult {
  dryRun: boolean;
  /** 드라이런이 환경 설정 때문에 강제되었다. */
  forcedDryRun?: true;
  /** 실제로 카카오에 보낸 통수. */
  sent: number;
  messages: { index: number; chars: number; text?: string }[];
}

/** 글자 수는 코드 포인트 기준(이모지 한 개를 한 글자로 센다). */
export const countChars = (text: string): number => Array.from(text).length;

/** 보내기 전에 한 통을 검사한다. 오류 메시지에는 본문을 넣지 않고 글자 수만 쓴다. */
export function checkMessage(text: string, index: number, total: number): number {
  const label = total > 1 ? `Message ${index + 1} of ${total}` : "Message";
  const chars = countChars(text);
  if (text.trim().length === 0) throw new AppError("validation_error", `${label} is empty.`);
  if (chars > TEXT_LIMIT) {
    throw new AppError("validation_error", `${label} is ${chars} characters, ${chars - TEXT_LIMIT} over the ${TEXT_LIMIT}-character limit. Shorten or split it before sending; nothing was sent.`);
  }
  return chars;
}

export class KakaoApi {
  private readonly fetchFn: FetchFn;

  constructor(
    private readonly auth: { getAccessToken(opts?: { force?: boolean }): Promise<string> },
    private readonly logger: Logger,
    private readonly opts: KakaoApiOptions,
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
  }

  sendOne(text: string, opts: { dryRun?: boolean } = {}): Promise<SendResult> {
    return this.sendMany([text], opts);
  }

  /** 모든 통을 먼저 검사한 뒤, 입력한 순서대로 하나씩 보낸다. 하나라도 검사에 걸리면 아무것도 보내지 않는다. */
  async sendMany(texts: readonly string[], opts: { dryRun?: boolean } = {}): Promise<SendResult> {
    if (texts.length === 0) throw new AppError("validation_error", "No messages given.");
    if (texts.length > MAX_BATCH) {
      throw new AppError("validation_error", `${texts.length} messages given; at most ${MAX_BATCH} can be sent at once. Nothing was sent.`);
    }
    const chars = texts.map((t, i) => checkMessage(t, i, texts.length));
    const forced = this.opts.dryRunAll && !opts.dryRun;
    const dryRun = Boolean(opts.dryRun) || this.opts.dryRunAll;

    if (dryRun) {
      this.logger.info("dry run", { op: "send", count: texts.length, chars: chars.reduce((a, b) => a + b, 0) });
      return { dryRun: true, ...(forced ? { forcedDryRun: true as const } : {}), sent: 0, messages: texts.map((text, i) => ({ index: i + 1, chars: chars[i] ?? 0, text })) };
    }

    if (!this.opts.linkUrl) throw new AppError("config_error", "KAKAO_LINK_URL is not set (Kakao text messages need a link).");
    for (let i = 0; i < texts.length; i++) {
      try {
        await this.post(texts[i] as string, this.opts.linkUrl);
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        const detail = texts.length > 1 ? ` Message ${i + 1} of ${texts.length} was not sent; ${i} before it were sent.` : "";
        throw new AppError(err.code, err.message + detail, { status: err.status, retryAfterSeconds: err.retryAfterSeconds });
      }
      this.logger.info("message sent", { op: "send", count: i + 1, chars: chars[i] });
    }
    return { dryRun: false, sent: texts.length, messages: texts.map((_t, i) => ({ index: i + 1, chars: chars[i] ?? 0 })) };
  }

  /** 인증 오류(401)이면 한 번만 갱신해서 다시 보낸다. 서버 오류는 재전송하지 않는다(중복 전송을 막기 위해). */
  private async post(text: string, link: string): Promise<void> {
    const body = new URLSearchParams({
      template_object: JSON.stringify({ object_type: "text", text, link: { web_url: link, mobile_web_url: link } }),
    }).toString();

    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken({ force: attempt > 0 });
      let res: Response;
      try {
        res = await this.fetchFn(MEMO_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
          body,
        });
      } catch {
        // 응답을 못 받았으니 카카오가 받았는지 알 수 없다. 성공으로 보지 않는다.
        throw new AppError("unavailable", "Could not reach Kakao; the message was not confirmed as sent.");
      }
      this.logger.debug("kakao request", { op: "send", status: res.status, attempt });
      if (res.ok) {
        const result = (await res.json().catch(() => ({}))) as { result_code?: number };
        if (result.result_code === 0) return;
        throw new AppError("upstream_error", "Kakao did not confirm the message as sent.", { status: res.status });
      }
      if (res.status === 401 && attempt === 0) continue;
      throw mapSendError(res.status, res.headers.get("retry-after"));
    }
  }
}

/** 카카오의 오류 응답을 분류한다. 설명문은 쓰지 않고 고정 문구만 쓴다. */
export function mapSendError(status: number, retryAfter: string | null): AppError {
  if (status === 401) return new AppError("auth_expired", "Kakao rejected the access token even after a refresh. Sign in to Kakao again (see README).", { status });
  if (status === 403) return new AppError("permission_denied", "Kakao denied the request (the app may lack the 'talk_message' consent).", { status });
  if (status === 400) return new AppError("validation_error", "Kakao rejected the message format. Nothing was sent.", { status });
  if (status === 429) {
    const secs = Number.parseInt(retryAfter ?? "", 10);
    return new AppError("rate_limited", "Kakao is throttling requests; the message was not sent.", { status, retryAfterSeconds: Number.isFinite(secs) ? secs : undefined });
  }
  if (status >= 500) return new AppError("unavailable", "Kakao is temporarily unavailable; the message was not sent.", { status });
  return new AppError("upstream_error", "Kakao returned an unexpected error; the message was not sent.", { status });
}
