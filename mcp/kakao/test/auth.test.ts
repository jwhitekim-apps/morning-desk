// my-task original code (not derived from upstream).
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KakaoAuth, TokenStore, type AuthSettings, type FetchFn } from "../src/auth/provider";

let dir: string;
let path: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kakao-mcp-test-")); path = join(dir, "sub", "token.json"); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const SETTINGS: AuthSettings = { restApiKey: "rest-key", clientSecret: "client-secret", refreshToken: "r-env" };

function fakeFetch(respond: (form: URLSearchParams) => { status?: number; body: unknown }) {
  const sent: URLSearchParams[] = [];
  const fn: FetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ""));
    sent.push(form);
    const r = respond(form);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as FetchFn;
  return { fn, sent };
}

const make = (respond: Parameters<typeof fakeFetch>[0], settings: AuthSettings = SETTINGS, now = () => 1_000_000) => {
  const net = fakeFetch(respond);
  const store = new TokenStore(path);
  return { net, store, auth: new KakaoAuth(store, () => settings, net.fn, now) };
};

describe("token refresh", () => {
  it("refreshes with the env refresh token on first use, sending the REST key and client secret", async () => {
    const { auth, net } = make(() => ({ body: { access_token: "a-1", expires_in: 3600 } }));
    expect(await auth.getAccessToken()).toBe("a-1");
    const form = net.sent[0]!;
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("client_id")).toBe("rest-key");
    expect(form.get("client_secret")).toBe("client-secret");
    expect(form.get("refresh_token")).toBe("r-env");
  });

  it("omits client_secret when the app has none", async () => {
    const { auth, net } = make(() => ({ body: { access_token: "a" } }), { ...SETTINGS, clientSecret: undefined });
    await auth.getAccessToken();
    expect(net.sent[0]!.has("client_secret")).toBe(false);
  });

  it("an expired access token is refreshed; a valid one is reused without calling Kakao", async () => {
    const { auth, store, net } = make(() => ({ body: { access_token: "a-new", expires_in: 3600 } }));
    store.write({ refresh_token: "r-1", access_token: "a-live", expires_at: 1_000_000 + 600_000, saved_at: "x" });
    expect(await auth.getAccessToken()).toBe("a-live");
    expect(net.sent).toHaveLength(0);
    store.write({ refresh_token: "r-1", access_token: "a-old", expires_at: 999_000, saved_at: "x" });
    expect(await auth.getAccessToken()).toBe("a-new");
    expect(net.sent).toHaveLength(1);
  });

  it("force refreshes even when the access token looks valid", async () => {
    const { auth, store, net } = make(() => ({ body: { access_token: "a-forced" } }));
    store.write({ refresh_token: "r-1", access_token: "a-live", expires_at: 1_000_000 + 600_000, saved_at: "x" });
    expect(await auth.getAccessToken({ force: true })).toBe("a-forced");
    expect(net.sent).toHaveLength(1);
  });

  it("a new refresh token in the response is saved and used by the next run; the file beats the env value", async () => {
    const first = make(() => ({ body: { access_token: "a-1", refresh_token: "r-NEW", expires_in: 1 } }));
    await first.auth.getAccessToken();
    expect(first.store.read()?.refresh_token).toBe("r-NEW");

    // 다음 실행: 환경 변수는 여전히 옛 값이지만 파일의 새 값을 써야 한다.
    const next = make(() => ({ body: { access_token: "a-2" } }), SETTINGS, () => 9_999_999_999);
    await next.auth.getAccessToken();
    expect(next.net.sent[0]!.get("refresh_token")).toBe("r-NEW");
  });

  it("keeps the old refresh token when the response has none", async () => {
    const { auth, store } = make(() => ({ body: { access_token: "a" } }));
    await auth.getAccessToken();
    expect(store.read()?.refresh_token).toBe("r-env");
  });

  it("saves with folder 700 and file 600, replacing atomically (no temp files left)", async () => {
    const { auth, store } = make(() => ({ body: { access_token: "a", refresh_token: "r-2" } }));
    await auth.getAccessToken();
    expect(statSync(join(dir, "sub")).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(store.read()?.refresh_token).toBe("r-2");
    expect(readdirSync(join(dir, "sub"))).toEqual(["token.json"]);
  });

  it("refreshes only once for concurrent callers", async () => {
    const { auth, net } = make(() => ({ body: { access_token: "a" } }));
    await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);
    expect(net.sent).toHaveLength(1);
  });
});

describe("failures are told apart", () => {
  it("an expired or revoked refresh token says to sign in to Kakao again", async () => {
    const { auth } = make(() => ({ status: 400, body: { error: "invalid_grant", error_description: "refresh token not found for 홍길동", error_code: "KOE322" } }));
    const err = await auth.getAccessToken().catch((e: Error) => e);
    expect(err).toMatchObject({ code: "auth_expired" });
    expect(String((err as Error).message)).toMatch(/Sign in to Kakao again/);
    expect(String((err as Error).message)).not.toContain("홍길동");
  });

  it("a rejected client is a config error; an outage is 'unavailable'; throttling is rate_limited", async () => {
    await expect(make(() => ({ status: 401, body: { error: "invalid_client" } })).auth.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
    await expect(make(() => ({ status: 503, body: {} })).auth.getAccessToken()).rejects.toMatchObject({ code: "unavailable" });
    await expect(make(() => ({ status: 429, body: {} })).auth.getAccessToken()).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("no refresh token anywhere -> auth_required without calling Kakao", async () => {
    const { auth, net } = make(() => ({ body: {} }), { ...SETTINGS, refreshToken: undefined });
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
  });

  it("a missing REST API key is a config error", async () => {
    await expect(make(() => ({ body: {} }), { ...SETTINGS, restApiKey: undefined }).auth.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
  });

  it("an unreadable token file asks for a new sign-in instead of crashing", async () => {
    const { auth } = make(() => ({ body: {} }));
    new TokenStore(path).write({ refresh_token: "x", saved_at: "x" });
    writeFileSync(path, "{broken");
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_required" });
  });
});

describe("status never reveals secrets", () => {
  it("reports where the refresh token comes from, without values", async () => {
    const { auth, store } = make(() => ({ body: {} }));
    expect(auth.status()).toEqual({ restApiKey: true, clientSecret: true, refreshToken: "env" });
    store.write({ refresh_token: "r-TOPSECRET", saved_at: "x" });
    expect(auth.status().refreshToken).toBe("file");
    expect(JSON.stringify(auth.status())).not.toMatch(/TOPSECRET|rest-key|client-secret/);
    expect(readFileSync(path, "utf-8")).toContain("TOPSECRET");
  });
});
