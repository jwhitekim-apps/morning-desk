// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import type { Logger } from "@morning-desk/shared";
import type { FetchFn } from "../auth/oauth";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";
/** 한 번의 호출 안에서 기다릴 수 있는 최대 시간. 이보다 길게 기다려야 하면 기다리지 않고 알려 준다. */
const MAX_INLINE_WAIT_MS = 10_000;

export type Query = Record<string, string | number | readonly string[]>;

interface GoogleErrorBody {
  error?: { code?: number; status?: string; errors?: { reason?: string }[]; details?: { reason?: string }[] };
}

const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "dailyLimitExceeded", "RATE_LIMIT_EXCEEDED"]);

/** Google의 오류 응답을 분류한다. 오류 설명문(메일 내용이 섞일 수 있음)은 쓰지 않고 고정 문구만 쓴다. */
export function mapGoogleError(status: number, body: GoogleErrorBody, retryAfterSeconds?: number): AppError {
  const reasons = [...(body.error?.errors ?? []), ...(body.error?.details ?? [])].map((e) => e.reason).filter(Boolean) as string[];
  if (status === 401) return new AppError("auth_expired", "Google rejected the access token. Run `morning-desk login gmail` again.", { status });
  if (status === 403 || status === 429) {
    if (status === 429 || reasons.some((r) => RATE_REASONS.has(r))) {
      return new AppError("rate_limited", "Gmail is throttling requests. Wait and try again.", { status, retryAfterSeconds });
    }
    if (reasons.includes("accessNotConfigured") || reasons.includes("SERVICE_DISABLED")) {
      return new AppError("config_error", "The Gmail API is not enabled for this Google Cloud project.", { status });
    }
    return new AppError("permission_denied", "Gmail denied this request (read-only access allows reading mail only).", { status });
  }
  if (status === 404) return new AppError("not_found", "No such message or thread.", { status });
  if (status === 400) return new AppError("validation_error", "Gmail rejected the request (check the search query or the id).", { status });
  if (status >= 500) return new AppError("unavailable", "Gmail is temporarily unavailable.", { status });
  return new AppError("google_error", "Gmail returned an unexpected error.", { status });
}

export interface GmailClientOptions {
  fetchFn?: FetchFn;
  baseUrl?: string;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Gmail REST API(읽기)를 부르는 얇은 클라이언트. 429와 5xx는 짧게 재시도하고, 그래도 안 되면 원인을 분류해서 알린다. */
export class GmailClient {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly auth: { getAccessToken(): Promise<string> },
    private readonly logger: Logger,
    opts: GmailClientOptions = {},
  ) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async getJson<T>(path: string, query: Query = {}, op = "get"): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === "object") for (const v of value) url.searchParams.append(key, v);
      else url.searchParams.set(key, String(value));
    }

    for (let attempt = 0; ; attempt++) {
      const token = await this.auth.getAccessToken();
      const startedAt = Date.now();
      let res: Response | null = null;
      try {
        res = await this.fetchFn(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
      } catch {
        // 네트워크 오류: 아래에서 재시도하거나 '일시 장애'로 알린다.
      }
      const status = res?.status ?? 0;
      this.logger.debug("gmail request", { op, status, attempt, durationMs: Date.now() - startedAt });

      if (res?.ok) return (await res.json()) as T;

      const retryAfter = Number.parseInt(res?.headers.get("retry-after") ?? "", 10);
      const retryAfterSeconds = Number.isFinite(retryAfter) ? retryAfter : undefined;
      const retryable = res === null || status === 429 || status >= 500 || (status === 403 && (await isRateLimited(res)));
      if (retryable && attempt < this.maxRetries) {
        const waitMs = Math.min((retryAfterSeconds ?? 2 ** attempt * 0.5) * 1000, MAX_INLINE_WAIT_MS);
        this.logger.warn("gmail retry", { op, status, attempt, waitMs });
        await this.sleep(waitMs);
        continue;
      }
      if (res === null) throw new AppError("unavailable", "Could not reach Gmail. Check the network and try again.");
      throw mapGoogleError(status, (await res.json().catch(() => ({}))) as GoogleErrorBody, retryAfterSeconds);
    }
  }
}

async function isRateLimited(res: Response): Promise<boolean> {
  const body = (await res.clone().json().catch(() => ({}))) as GoogleErrorBody;
  return (body.error?.errors ?? []).some((e) => e.reason && RATE_REASONS.has(e.reason));
}
