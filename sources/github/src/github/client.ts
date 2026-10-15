// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import type { Logger } from "@morning-desk/shared";

export type FetchFn = typeof fetch;
export type TokenKind = "search" | "notifications";

const BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

/**
 * 허용하는 클래식 토큰 권한: `read:*`와 `notifications`뿐.
 * `repo`, `workflow`, `write:*`, `admin:*`, `delete_repo` 같은 권한이 하나라도 있으면 거부한다
 * (예: `gh auth`의 기존 토큰). fine-grained 토큰은 이 헤더가 없어서 검사할 수 없다.
 */
export function assertReadOnlyScopes(header: string | null): void {
  const scopes = (header ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const bad = scopes.filter((s) => !(s.startsWith("read:") || s === "notifications"));
  if (bad.length > 0) {
    throw new AppError(
      "config_error",
      `The token has scopes beyond read-only (${bad.join(", ")}). Use a fine-grained read-only token (search) or a classic token with only the 'notifications' scope.`,
    );
  }
}

const kstIso = (ms: number): string => new Date(ms + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00";

export interface Response2<T> {
  json: T;
  headers: Headers;
}

export interface ClientOptions {
  token: string | undefined;
  notificationsToken: string | undefined;
  fetchFn?: FetchFn;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** GitHub REST API를 GET으로만 부르는 얇은 클라이언트. 토큰은 쓰기 전에 권한을 검사한다. */
export class GithubClient {
  private readonly fetchFn: FetchFn;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly checked = new Map<TokenKind, Promise<string>>();

  constructor(private readonly logger: Logger, private readonly opts: ClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? Date.now;
  }

  hasToken(kind: TokenKind): boolean {
    return Boolean(kind === "search" ? this.opts.token : this.opts.notificationsToken);
  }

  /** 인증된 사용자의 로그인 이름. 처음 한 번 `/user`를 불러 토큰 권한도 검사한다. */
  login(kind: TokenKind): Promise<string> {
    let p = this.checked.get(kind);
    if (!p) {
      p = this.rawGet<{ login?: string }>(kind, "/user", {}, "user").then(({ json, headers }) => {
        assertReadOnlyScopes(headers.get("x-oauth-scopes"));
        if (!json.login) throw new AppError("upstream_error", "GitHub did not return the authenticated user.");
        return json.login;
      });
      // 실패했으면 다음에 다시 시도할 수 있도록 캐시하지 않는다.
      p.catch(() => this.checked.delete(kind));
      this.checked.set(kind, p);
    }
    return p;
  }

  /** 권한 검사를 통과한 토큰으로 GET을 보낸다. */
  async get<T>(kind: TokenKind, path: string, query: Record<string, string | number> = {}, op = "get"): Promise<Response2<T>> {
    await this.login(kind);
    return this.rawGet<T>(kind, path, query, op);
  }

  private async rawGet<T>(kind: TokenKind, path: string, query: Record<string, string | number>, op: string): Promise<Response2<T>> {
    const token = kind === "search" ? this.opts.token : this.opts.notificationsToken;
    if (!token) {
      throw new AppError(
        "config_error",
        kind === "search" ? "GITHUB_MCP_TOKEN is not set (a read-only fine-grained token)." : "GITHUB_MCP_NOTIFICATIONS_TOKEN is not set (a classic token with only the 'notifications' scope); the notifications tool is off.",
      );
    }
    const url = new URL(path, BASE);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

    for (let attempt = 0; ; attempt++) {
      const startedAt = Date.now();
      let res: Response | null = null;
      try {
        res = await this.fetchFn(url, {
          method: "GET",
          headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": API_VERSION, "User-Agent": "my-task-github-mcp" },
        });
      } catch {
        /* 아래에서 재시도하거나 '일시 장애'로 알린다 */
      }
      const status = res?.status ?? 0;
      this.logger.debug("github request", { op, status, attempt, durationMs: Date.now() - startedAt });
      if (res?.ok) return { json: (await res.json()) as T, headers: res.headers };

      if ((res === null || status >= 500) && attempt < this.maxRetries) {
        const waitMs = 2 ** attempt * 500;
        this.logger.warn("github retry", { op, status, attempt, waitMs });
        await this.sleep(waitMs);
        continue;
      }
      if (res === null) throw new AppError("unavailable", "Could not reach GitHub. Check the network and try again.");
      throw await this.mapError(res);
    }
  }

  /** 오류 응답을 분류한다. 설명문은 쓰지 않고 고정 문구만 쓴다. */
  private async mapError(res: Response): Promise<AppError> {
    const status = res.status;
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    const remaining = res.headers.get("x-ratelimit-remaining");
    const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "", 10);
    const reset = Number.parseInt(res.headers.get("x-ratelimit-reset") ?? "", 10);
    const limited = status === 429 || (status === 403 && (remaining === "0" || Number.isFinite(retryAfter) || /rate limit/i.test(body.message ?? "")));
    if (limited) {
      const nowMs = this.now();
      const secs = Number.isFinite(retryAfter) ? retryAfter : Number.isFinite(reset) ? Math.max(0, reset - Math.floor(nowMs / 1000)) : undefined;
      const retryAt = secs === undefined ? undefined : kstIso(nowMs + secs * 1000);
      return new AppError("rate_limited", `GitHub's request limit was exceeded.${retryAt ? ` Try again after ${retryAt}.` : ""}`, { status, retryAfterSeconds: secs, retryAt });
    }
    if (status === 401) return new AppError("auth_failed", "GitHub rejected the token (invalid, expired or revoked).", { status });
    if (status === 403) return new AppError("permission_denied", "GitHub denied this request: the token lacks the needed read permission or access to the repository.", { status });
    if (status === 404) return new AppError("not_found", "GitHub could not find that resource (or the token cannot see it).", { status });
    if (status === 422 || status === 400) return new AppError("validation_error", "GitHub rejected the request.", { status });
    if (status >= 500) return new AppError("unavailable", "GitHub is temporarily unavailable.", { status });
    return new AppError("upstream_error", "GitHub returned an unexpected error.", { status });
  }
}
