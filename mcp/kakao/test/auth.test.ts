// my-task original code (not derived from upstream).
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KakaoAuth, REFRESH_TOKEN_KEY, TokenStore, type AuthSettings, type FetchFn } from "../src/auth/provider";

let dir: string;
let path: string;
const OTHER = "# 정리된 설정\nGMAIL_REFRESH_TOKEN=gg\n\n# 카카오\nKAKAO_REST_API_KEY=rest-key\nKAKAO_REFRESH_TOKEN=r-env\nKAKAO_LINK_URL=https://x\n";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kakao-mcp-test-"));
  path = join(dir, ".env.local");
  writeFileSync(path, OTHER, { mode: 0o600 });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const SETTINGS: AuthSettings = { restApiKey: "rest-key", clientSecret: "client-secret" };

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
  it("refreshes with the .env.local refresh token on first use, sending the REST key and client secret", async () => {
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

  it("keeps the access token in memory only; reuses it until it nears expiry", async () => {
    let t = 1_000_000;
    const { auth, net } = make(() => ({ body: { access_token: "a-new", expires_in: 3600 } }), SETTINGS, () => t);
    expect(await auth.getAccessToken()).toBe("a-new");
    expect(readFileSync(path, "utf-8")).toBe(OTHER);
    t += 600_000;
    expect(await auth.getAccessToken()).toBe("a-new");
    expect(net.sent).toHaveLength(1);
    t += 3600_000;
    await auth.getAccessToken();
    expect(net.sent).toHaveLength(2);
  });

  it("force refreshes even when the access token looks valid", async () => {
    const { auth, net } = make(() => ({ body: { access_token: "a-forced" } }));
    await auth.getAccessToken();
    expect(await auth.getAccessToken({ force: true })).toBe("a-forced");
    expect(net.sent).toHaveLength(2);
  });

  it("a new refresh token changes only the KAKAO_REFRESH_TOKEN line and is used by the next run", async () => {
    const first = make(() => ({ body: { access_token: "a-1", refresh_token: "r-NEW", expires_in: 1 } }));
    await first.auth.getAccessToken();
    expect(await first.store.read()).toBe("r-NEW");
    expect(readFileSync(path, "utf-8")).toBe(OTHER.replace(`${REFRESH_TOKEN_KEY}=r-env`, `${REFRESH_TOKEN_KEY}=r-NEW`));
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([".env.local"]);

    const next = make(() => ({ body: { access_token: "a-2" } }));
    await next.auth.getAccessToken();
    expect(next.net.sent[0]!.get("refresh_token")).toBe("r-NEW");
  });

  it("does not touch the line when the response has no new refresh token", async () => {
    const { auth } = make(() => ({ body: { access_token: "a" } }));
    await auth.getAccessToken();
    expect(readFileSync(path, "utf-8")).toBe(OTHER);
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

  it("no refresh token in .env.local -> auth_required without calling Kakao", async () => {
    writeFileSync(path, "KAKAO_REST_API_KEY=rest-key\n");
    const { auth, net } = make(() => ({ body: {} }));
    await expect(auth.getAccessToken()).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
  });

  it("a missing REST API key is a config error", async () => {
    await expect(make(() => ({ body: {} }), { ...SETTINGS, restApiKey: undefined }).auth.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
  });

});

describe("status never reveals secrets", () => {
  it("reports whether the refresh token is set, without values", async () => {
    const { auth } = make(() => ({ body: {} }));
    expect(await auth.status()).toEqual({ restApiKey: true, clientSecret: true, refreshToken: true });
    expect(JSON.stringify(await auth.status())).not.toMatch(/r-env|rest-key|client-secret/);
    writeFileSync(path, "");
    expect((await auth.status()).refreshToken).toBe(false);
  });
});
