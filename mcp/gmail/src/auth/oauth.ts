// my-task original code (not derived from upstream).
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { AppError } from "../errors";
import type { OAuthClient, StoredToken, TokenStore } from "./store";

/** 요청하는 Gmail 권한은 이것 하나뿐이다(읽기 전용). */
export const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const EXPIRY_MARGIN_MS = 60_000;

export type FetchFn = typeof fetch;

const b64url = (buf: Buffer): string => buf.toString("base64url");

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const url = new URL(AUTH_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: "code",
    scope: GMAIL_READONLY_SCOPE,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    access_type: "offline",
    // 갱신 토큰을 확실히 받기 위해 동의 화면을 다시 띄운다.
    prompt: "consent",
  }).toString();
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function postToken(fetchFn: FetchFn, form: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    throw new AppError("unavailable", "Could not reach Google's token endpoint. Check the network and try again.");
  }
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (res.ok) return body;
  // 오류 설명문은 쓰지 않고 분류만 보고 고정 문구를 쓴다.
  if (body.error === "invalid_grant") {
    throw new AppError("auth_expired", "The saved sign-in is no longer valid (revoked or expired). Run `login` again.", { status: res.status });
  }
  if (body.error === "invalid_client" || body.error === "unauthorized_client") {
    throw new AppError("config_error", "Google rejected the OAuth client id or secret. Check the client settings.", { status: res.status });
  }
  if (res.status === 429) throw new AppError("rate_limited", "Google's token endpoint is throttling requests.", { status: 429 });
  if (res.status >= 500) throw new AppError("unavailable", "Google's token endpoint is temporarily unavailable.", { status: res.status });
  throw new AppError("google_error", "Google's token endpoint returned an error.", { status: res.status });
}

/** 저장된 토큰을 읽고, 액세스 토큰이 곧 만료되면 갱신 토큰으로 새로 받는다. 동시에 여러 번 불러도 갱신은 한 번만 한다. */
export class TokenProvider {
  private inflight: Promise<string> | null = null;

  constructor(
    private readonly store: TokenStore,
    private readonly client: () => OAuthClient,
    private readonly fetchFn: FetchFn = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** 로그인되어 있는지만 본다(네트워크 없음). 토큰 값은 돌려주지 않는다. */
  status(): { signedIn: boolean; scope?: string } {
    const t = this.store.read();
    return t ? { signedIn: true, scope: t.scope } : { signedIn: false };
  }

  getAccessToken(): Promise<string> {
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<string> {
    const saved = this.store.read();
    if (!saved) throw new AppError("auth_required", "Not signed in. Run `login` first.");
    if (saved.scope !== GMAIL_READONLY_SCOPE) {
      throw new AppError("permission_denied", "The saved sign-in has a scope other than read-only Gmail. Run `logout` then `login`.");
    }
    if (saved.access_token && saved.expires_at && saved.expires_at - EXPIRY_MARGIN_MS > this.now()) return saved.access_token;

    const { clientId, clientSecret } = this.client();
    const body = await postToken(this.fetchFn, {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: saved.refresh_token,
    });
    if (!body.access_token) throw new AppError("google_error", "Google returned no access token.");
    this.store.write({
      ...saved,
      // 구글은 갱신 응답에 새 갱신 토큰을 안 주는 것이 보통이다. 주면 새것으로 바꾼다.
      refresh_token: body.refresh_token ?? saved.refresh_token,
      access_token: body.access_token,
      expires_at: this.now() + (body.expires_in ?? 3600) * 1000,
      saved_at: new Date(this.now()).toISOString(),
    });
    return body.access_token;
  }
}

export interface LoginOptions {
  store: TokenStore;
  client: OAuthClient;
  /** 사용자가 열어야 할 주소를 알린다(브라우저 자동 실행은 호출하는 쪽 몫). */
  onUrl: (url: string) => void;
  fetchFn?: FetchFn;
  now?: () => number;
  timeoutMs?: number;
}

/** 로컬 되돌림 주소(127.0.0.1)와 PKCE를 쓰는 설치형 앱 로그인. 성공하면 토큰을 저장한다. */
export async function login(opts: LoginOptions): Promise<void> {
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? Date.now;
  const pkce = newPkce();
  const state = b64url(randomBytes(16));

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  try {
    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new AppError("auth_required", "Sign-in timed out.")), opts.timeoutMs ?? 300_000);
      server.on("request", (req, res) => {
        const url = new URL(req.url ?? "/", redirectUri);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const finish = (status: number, text: string) => res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" }).end(text);
        if (url.searchParams.get("state") !== state) {
          finish(400, "state mismatch");
          return;
        }
        clearTimeout(timer);
        const got = url.searchParams.get("code");
        if (!got) {
          finish(400, "Sign-in was not completed.");
          reject(new AppError("auth_required", "Sign-in was cancelled or denied."));
          return;
        }
        finish(200, "Signed in. You can close this window.");
        resolve(got);
      });
      opts.onUrl(buildAuthUrl({ clientId: opts.client.clientId, redirectUri, state, challenge: pkce.challenge }));
    });

    const body = await postToken(fetchFn, {
      client_id: opts.client.clientId,
      client_secret: opts.client.clientSecret,
      grant_type: "authorization_code",
      code,
      code_verifier: pkce.verifier,
      redirect_uri: redirectUri,
    });
    if (!body.refresh_token) {
      throw new AppError("google_error", "Google returned no refresh token. Remove this app at https://myaccount.google.com/permissions and sign in again.");
    }
    // 허용된 권한이 읽기 전용 하나뿐인지 확인한다. 더 넓은 권한이 딸려 왔으면 저장하지 않는다.
    if ((body.scope ?? "").split(" ").some((s) => s && s !== GMAIL_READONLY_SCOPE)) {
      throw new AppError("permission_denied", "Google granted more than read-only Gmail access; refusing to save the sign-in.");
    }
    const token: StoredToken = {
      refresh_token: body.refresh_token,
      access_token: body.access_token,
      expires_at: body.access_token ? now() + (body.expires_in ?? 3600) * 1000 : undefined,
      scope: GMAIL_READONLY_SCOPE,
      saved_at: new Date(now()).toISOString(),
    };
    opts.store.write(token);
  } finally {
    server.close();
  }
}
