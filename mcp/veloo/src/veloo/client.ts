// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import type { Logger } from "../logger";
import type { SessionStore } from "./session";

export type FetchFn = typeof fetch;

/** 로그인에 실패하면 벨루가 IP 기준으로 15분 동안 5번까지만 허용한다. 실패 뒤에는 이 시간 동안 다시 시도하지 않는다. */
const LOGIN_COOLDOWN_MS = 15 * 60_000;

export interface ClientOptions {
  baseUrl: string | undefined;
  username: string | undefined;
  password: string | undefined;
  store: SessionStore;
  fetchFn?: FetchFn;
  now?: () => number;
}

/**
 * 벨루 내부 API를 GET으로 읽는 클라이언트. 로그인(POST /login)만 예외로 POST를 쓰고, 그것도 계정 확인용이다.
 * 세션이 있으면 재사용하고, 401이면 한 번만 다시 로그인해서 재시도한다.
 */
export class VelooClient {
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private cookie: string | null = null;
  private loadedFromStore = false;
  private loginInflight: Promise<string> | null = null;
  private lastLoginFailure: { at: number; error: AppError } | null = null;

  constructor(private readonly logger: Logger, private readonly opts: ClientOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
  }

  async status(): Promise<{ configured: boolean; savedSession: boolean }> {
    return { configured: Boolean(this.opts.baseUrl && this.opts.username && this.opts.password), savedSession: Boolean(this.cookie ?? (await this.opts.store.read())) };
  }

  private base(): string {
    const raw = this.opts.baseUrl;
    if (!raw || !this.opts.username || !this.opts.password) {
      throw new AppError("config_error", "VELOO_BASE_URL, VELOO_USERNAME and VELOO_PASSWORD must be set.");
    }
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new AppError("config_error", "VELOO_BASE_URL is not a valid URL.");
    }
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new AppError("config_error", "VELOO_BASE_URL must use https (the account password is sent to it).");
    }
    return url.origin;
  }

  /** 조회(GET). 응답 본문(JSON)을 돌려준다. 저장된 세션이 거부되면 한 번만 다시 로그인해서 재시도한다. */
  async get(path: string, op: string): Promise<unknown> {
    const base = this.base();
    const reused = this.cookie ?? (await this.loadSaved());
    // 이번 호출에서 방금 로그인한 세션이 거부되면 다시 로그인해도 소용이 없고 벨루에 세션만 쌓인다. 그때는 바로 포기한다.
    const fresh = reused === null;
    let cookie = reused ?? (await this.login());
    for (let attempt = 0; ; attempt++) {
      const startedAt = Date.now();
      let res: Response;
      try {
        res = await this.fetchFn(`${base}${path}`, { method: "GET", headers: { cookie, accept: "application/json" }, redirect: "manual" });
      } catch {
        throw new AppError("unavailable", "Could not reach Veloo. The server may be off or the network is down.");
      }
      this.logger.debug("veloo request", { op, status: res.status, attempt, durationMs: Date.now() - startedAt });
      // 벨루는 세션이 없으면 401을 돌려주거나(API) 로그인 화면으로 보낸다(리다이렉트). 둘 다 세션 문제로 본다.
      const sessionProblem = res.status === 401 || (res.status >= 300 && res.status < 400);
      if (sessionProblem && attempt === 0 && !fresh) {
        this.cookie = null;
        await this.opts.store.clear();
        cookie = await this.login();
        continue;
      }
      if (sessionProblem) throw new AppError("auth_failed", "Veloo rejected the session even after signing in again.", { status: res.status });
      if (!res.ok) throw mapStatus(res);
      try {
        return await res.json();
      } catch {
        throw new AppError("contract_changed", "Veloo returned a response that is not JSON; its API may have changed.", { status: res.status });
      }
    }
  }

  private async loadSaved(): Promise<string | null> {
    if (this.loadedFromStore) return null;
    this.loadedFromStore = true;
    this.cookie = await this.opts.store.read();
    return this.cookie;
  }

  /** 로그인. 동시에 여러 번 불러도 한 번만 한다. 실패하면 15분 동안은 다시 시도하지 않고 같은 오류를 돌려준다. */
  private login(): Promise<string> {
    if (this.lastLoginFailure && this.now() - this.lastLoginFailure.at < LOGIN_COOLDOWN_MS) {
      return Promise.reject(this.lastLoginFailure.error);
    }
    this.loginInflight ??= this.doLogin().finally(() => {
      this.loginInflight = null;
    });
    return this.loginInflight;
  }

  private async doLogin(): Promise<string> {
    const base = this.base();
    let res: Response;
    try {
      res = await this.fetchFn(`${base}/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: this.opts.username, password: this.opts.password }),
        redirect: "manual",
      });
    } catch {
      throw new AppError("unavailable", "Could not reach Veloo to sign in. The server may be off or the network is down.");
    }
    this.logger.debug("veloo login", { op: "login", status: res.status });
    if (!res.ok) {
      const err = loginError(res);
      // 서버가 잠그지 않도록, 계정 정보 문제로 거부된 경우에만 쉬는 시간을 둔다(일시 장애는 바로 다시 시도할 수 있다).
      if (err.code === "auth_failed" || err.code === "permission_denied" || err.code === "rate_limited") this.lastLoginFailure = { at: this.now(), error: err };
      throw err;
    }
    const token = res.headers.getSetCookie().map((c) => c.split(";")[0] ?? "").find((c) => c.startsWith("access_token="));
    if (!token) throw new AppError("contract_changed", "Veloo's login returned no session cookie; its API may have changed.");
    this.lastLoginFailure = null;
    this.cookie = token;
    await this.opts.store.write(token);
    return token;
  }
}

/** 로그인 응답의 오류를 분류한다. 서버의 설명문은 쓰지 않고 고정 문구만 쓴다. */
function loginError(res: Response): AppError {
  const status = res.status;
  if (status === 401) return new AppError("auth_failed", "Veloo rejected the username or password. Not retrying, to avoid locking the account (5 failures lock the IP for 15 minutes).", { status });
  if (status === 403) return new AppError("permission_denied", "Veloo says this account is not approved yet.", { status });
  if (status === 429) return new AppError("rate_limited", "Veloo locked sign-in after too many failed attempts. Wait about 15 minutes.", { status, retryAfterSeconds: 15 * 60 });
  if (status >= 500) return new AppError("unavailable", "Veloo is temporarily unavailable.", { status });
  return new AppError("upstream_error", "Veloo's login returned an unexpected response.", { status });
}

function mapStatus(res: Response): AppError {
  const status = res.status;
  if (status === 400 || status === 422) return new AppError("validation_error", "Veloo rejected the request.", { status });
  if (status === 403) return new AppError("permission_denied", "Veloo denied this request.", { status });
  if (status === 404) return new AppError("contract_changed", "Veloo has no such endpoint; its API may have changed.", { status });
  if (status === 429) return new AppError("rate_limited", "Veloo is throttling requests.", { status });
  if (status >= 500) return new AppError("unavailable", "Veloo is temporarily unavailable.", { status });
  return new AppError("upstream_error", "Veloo returned an unexpected error.", { status });
}
