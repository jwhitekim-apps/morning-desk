// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import { openEnvFile, type EnvFile } from "../env-file";

const TOKEN_ENDPOINT = "https://kauth.kakao.com/oauth/token";
const EXPIRY_MARGIN_MS = 60_000;

export type FetchFn = typeof fetch;

export const REFRESH_TOKEN_KEY = "KAKAO_REFRESH_TOKEN";

/** 리프레시 토큰은 루트 `.env.local`의 `KAKAO_REFRESH_TOKEN` 줄에 둔다. 갱신 응답에 새 값이 오면 그 줄을 고쳐 쓴다. */
export class TokenStore {
  private readonly file: EnvFile;

  constructor(path: string) {
    this.file = openEnvFile({ keys: [REFRESH_TOKEN_KEY], path });
  }

  async read(): Promise<string | null> {
    return (await this.file.get(REFRESH_TOKEN_KEY)) ?? null;
  }

  async write(refreshToken: string): Promise<void> {
    await this.file.set(REFRESH_TOKEN_KEY, refreshToken);
  }
}

export interface AuthSettings {
  restApiKey: string | undefined;
  clientSecret: string | undefined;
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

/** 액세스 토큰을 돌려준다(메모리에만 둔다). 만료가 가까우면(또는 `force`) 리프레시 토큰으로 갱신하고, 새 리프레시 토큰이 오면 저장한다. */
export class KakaoAuth {
  private inflight: Promise<string> | null = null;
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly settings: () => AuthSettings,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** 설정 상태만 본다(네트워크 없음, 값은 돌려주지 않는다). */
  async status(): Promise<{ restApiKey: boolean; clientSecret: boolean; refreshToken: boolean }> {
    const s = this.settings();
    return {
      restApiKey: Boolean(s.restApiKey),
      clientSecret: Boolean(s.clientSecret),
      refreshToken: Boolean(await this.store.read()),
    };
  }

  getAccessToken(opts: { force?: boolean } = {}): Promise<string> {
    this.inflight ??= this.load(Boolean(opts.force)).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(force: boolean): Promise<string> {
    if (!force && this.access && this.access.expiresAt - EXPIRY_MARGIN_MS > this.now()) return this.access.token;
    const s = this.settings();
    const refreshToken = await this.store.read();
    if (!refreshToken) throw new AppError("auth_required", "No Kakao refresh token. Put KAKAO_REFRESH_TOKEN in .env.local (see README).");
    if (!s.restApiKey) throw new AppError("config_error", "KAKAO_REST_API_KEY is not set.");

    const form: Record<string, string> = { grant_type: "refresh_token", client_id: s.restApiKey, refresh_token: refreshToken };
    if (s.clientSecret) form.client_secret = s.clientSecret;
    const body = await postToken(this.fetchFn, form);
    if (!body.access_token) throw new AppError("upstream_error", "Kakao returned no access token.");
    // 새 리프레시 토큰이 오면 이어 쓰기 위해 저장한다. 안 오면 줄을 건드리지 않는다.
    if (body.refresh_token && body.refresh_token !== refreshToken) await this.store.write(body.refresh_token);
    this.access = { token: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }
}
