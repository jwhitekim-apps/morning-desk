// my-task original code (not derived from upstream).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { AppError } from "../errors";

const TOKEN_ENDPOINT = "https://kauth.kakao.com/oauth/token";
const EXPIRY_MARGIN_MS = 60_000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

export type FetchFn = typeof fetch;

/** 저장하는 토큰. 갱신 응답에 새 리프레시 토큰이 오면 이 파일이 최신 값을 쥔다. */
export interface StoredToken {
  refresh_token: string;
  access_token?: string;
  /** 액세스 토큰 만료 시각(ms, epoch). */
  expires_at?: number;
  saved_at: string;
}

/** 폴더는 700, 파일은 600. 임시 파일에 쓴 뒤 이름을 바꿔서 쓰다 끊겨도 깨진 파일이 남지 않는다. */
export class TokenStore {
  constructor(private readonly path: string) {}

  read(): StoredToken | null {
    if (!existsSync(this.path)) return null;
    try {
      const t = JSON.parse(readFileSync(this.path, "utf-8")) as Partial<StoredToken>;
      if (typeof t.refresh_token === "string" && t.refresh_token) return t as StoredToken;
    } catch {
      /* 아래 오류로 이어진다 */
    }
    throw new AppError("auth_required", "The saved Kakao token file is unreadable. Sign in to Kakao again and replace it (see README).");
  }

  write(token: StoredToken): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    if ((statSync(dir).mode & 0o777) !== DIR_MODE) chmodSync(dir, DIR_MODE);
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(token, null, 2), { mode: FILE_MODE });
    chmodSync(tmp, FILE_MODE);
    renameSync(tmp, this.path);
  }
}

export interface AuthSettings {
  restApiKey: string | undefined;
  clientSecret: string | undefined;
  /** 환경 변수로 준 시작 값. 토큰 파일이 있으면 파일이 우선한다. */
  refreshToken: string | undefined;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
}

async function postToken(fetchFn: FetchFn, form: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new AppError("unavailable", "Could not reach Kakao's token endpoint. Check the network and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (res.ok) return body;
  // 오류 설명문은 쓰지 않고 분류만 보고 고정 문구를 쓴다.
  if (body.error === "invalid_grant") {
    throw new AppError("auth_expired", "The Kakao refresh token is no longer valid (expired or revoked). Sign in to Kakao again to get a new one (see README).", { status: res.status });
  }
  if (body.error === "invalid_client") {
    throw new AppError("config_error", "Kakao rejected the REST API key or client secret. Check KAKAO_REST_API_KEY and KAKAO_CLIENT_SECRET.", { status: res.status });
  }
  if (res.status === 429) throw new AppError("rate_limited", "Kakao's token endpoint is throttling requests.", { status: 429 });
  if (res.status >= 500) throw new AppError("unavailable", "Kakao's token endpoint is temporarily unavailable.", { status: res.status });
  throw new AppError("upstream_error", "Kakao's token endpoint returned an error.", { status: res.status });
}

/** 액세스 토큰을 돌려준다. 만료가 가까우면(또는 `force`) 리프레시 토큰으로 갱신하고, 새 리프레시 토큰이 오면 저장한다. */
export class KakaoAuth {
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly settings: () => AuthSettings,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** 설정 상태만 본다(네트워크 없음, 값은 돌려주지 않는다). */
  status(): { restApiKey: boolean; clientSecret: boolean; refreshToken: "file" | "env" | "none" } {
    const s = this.settings();
    return {
      restApiKey: Boolean(s.restApiKey),
      clientSecret: Boolean(s.clientSecret),
      refreshToken: this.store.read() ? "file" : s.refreshToken ? "env" : "none",
    };
  }

  getAccessToken(opts: { force?: boolean } = {}): Promise<string> {
    this.inflight ??= this.load(Boolean(opts.force)).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(force: boolean): Promise<string> {
    const s = this.settings();
    const saved: StoredToken | null = this.store.read() ?? (s.refreshToken ? { refresh_token: s.refreshToken, saved_at: "" } : null);
    if (!saved) throw new AppError("auth_required", "No Kakao refresh token. Set KAKAO_REFRESH_TOKEN or place a token file (see README).");
    if (!force && saved.access_token && saved.expires_at && saved.expires_at - EXPIRY_MARGIN_MS > this.now()) return saved.access_token;
    if (!s.restApiKey) throw new AppError("config_error", "KAKAO_REST_API_KEY is not set.");

    const form: Record<string, string> = { grant_type: "refresh_token", client_id: s.restApiKey, refresh_token: saved.refresh_token };
    if (s.clientSecret) form.client_secret = s.clientSecret;
    const body = await postToken(this.fetchFn, form);
    if (!body.access_token) throw new AppError("upstream_error", "Kakao returned no access token.");
    this.store.write({
      // 새 리프레시 토큰이 오면 이어 쓰기 위해 저장한다. 안 오면 기존 것을 유지한다.
      refresh_token: body.refresh_token ?? saved.refresh_token,
      access_token: body.access_token,
      expires_at: this.now() + (body.expires_in ?? 3600) * 1000,
      saved_at: new Date(this.now()).toISOString(),
    });
    return body.access_token;
  }
}
