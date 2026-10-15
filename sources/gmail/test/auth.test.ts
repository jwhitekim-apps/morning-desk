// my-task original code (not derived from upstream).
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthUrl, GMAIL_READONLY_SCOPE, login, newPkce, TokenProvider, type FetchFn } from "../src/auth/oauth";
import { loadOAuthClient, REFRESH_TOKEN_KEY, TokenStore } from "../src/auth/store";

const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };

let dir: string;
let envPath: string;
const OTHER = "# 정리된 설정\nGMAIL_CLIENT_ID=cid\n\nKAKAO_REFRESH_TOKEN=kk\n";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gmail-mcp-test-"));
  envPath = join(dir, ".env.local");
  writeFileSync(envPath, OTHER, { mode: 0o600 });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

interface Sent { url: string; form: URLSearchParams }
/** 토큰 엔드포인트를 흉내 낸다. 보낸 요청을 기록하고 준비한 응답을 돌려준다. */
function fakeFetch(respond: (form: URLSearchParams) => { status?: number; body: unknown }) {
  const sent: Sent[] = [];
  const fn: FetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ""));
    sent.push({ url: String(url), form });
    const r = respond(form);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { "Content-Type": "application/json" } });
  }) as FetchFn;
  return { fn, sent };
}


describe("authorization request", () => {
  it("asks for the read-only Gmail scope and nothing else, with PKCE and offline access", () => {
    const { challenge } = newPkce();
    const url = new URL(buildAuthUrl({ clientId: "cid", redirectUri: "http://127.0.0.1:1/callback", state: "s", challenge }));
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect([...url.searchParams.keys()].filter((k) => k.startsWith("scope"))).toEqual(["scope"]);
  });
});

describe("TokenStore (.env.local)", () => {
  it("writes only the GMAIL_REFRESH_TOKEN line, keeps other lines, and the file stays 600", async () => {
    const store = new TokenStore(envPath);
    await store.write("r-1");
    await store.write("r-2");
    expect(await store.read()).toBe("r-2");
    const text = readFileSync(envPath, "utf-8");
    expect(text.startsWith(OTHER)).toBe(true);
    expect(text.split("\n").filter((l) => l.startsWith(`${REFRESH_TOKEN_KEY}=`))).toEqual([`${REFRESH_TOKEN_KEY}=r-2`]);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
  });

  it("a missing line or missing file means 'not signed in'", async () => {
    expect(await new TokenStore(envPath).read()).toBeNull();
    expect(await new TokenStore(join(dir, "none", ".env.local")).read()).toBeNull();
  });

  it("logout removes only that line", async () => {
    const store = new TokenStore(envPath);
    await store.write("r-1");
    await store.clear();
    expect(await store.read()).toBeNull();
    expect(readFileSync(envPath, "utf-8").startsWith(OTHER)).toBe(true);
  });
});

describe("OAuth client loading", () => {
  it("uses GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET", () => {
    expect(loadOAuthClient({ clientId: "x", clientSecret: "y" })).toEqual({ clientId: "x", clientSecret: "y" });
  });
  it("says what to do when nothing is configured, without a stack trace", () => {
    expect(() => loadOAuthClient({})).toThrowError(/GMAIL_CLIENT_ID/);
  });
});

describe("TokenProvider", () => {
  const make = async (refresh: string | null, respond: Parameters<typeof fakeFetch>[0], now = () => 1_000_000) => {
    const store = new TokenStore(envPath);
    if (refresh !== null) await store.write(refresh);
    const net = fakeFetch(respond);
    return { store, net, provider: new TokenProvider(store, () => CLIENT, net.fn, now) };
  };

  it("not signed in -> auth_required, without calling Google", async () => {
    const { provider, net } = await make(null, () => ({ body: {} }));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
    expect(await provider.status()).toEqual({ signedIn: false });
  });

  it("gets an access token with the refresh token and keeps it in memory only", async () => {
    let t = 1_000_000;
    const { provider, net } = await make("r-1", () => ({ body: { access_token: "a-new", expires_in: 3600 } }), () => t);
    expect(await provider.getAccessToken()).toBe("a-new");
    expect(net.sent[0]?.form.get("grant_type")).toBe("refresh_token");
    expect(net.sent[0]?.form.get("refresh_token")).toBe("r-1");
    expect(readFileSync(envPath, "utf-8")).not.toContain("a-new");
    t += 10 * 60_000;
    expect(await provider.getAccessToken()).toBe("a-new");
    expect(net.sent).toHaveLength(1);
    t += 3600_000;
    await provider.getAccessToken();
    expect(net.sent).toHaveLength(2);
  });

  it("saves a new refresh token when Google sends one", async () => {
    const { provider, store } = await make("r-1", () => ({ body: { access_token: "a", refresh_token: "r-rotated" } }));
    await provider.getAccessToken();
    expect(await store.read()).toBe("r-rotated");
  });

  it("refreshes only once for concurrent callers", async () => {
    const { provider, net } = await make("r-1", () => ({ body: { access_token: "a-new", expires_in: 3600 } }));
    const tokens = await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.getAccessToken()]);
    expect(tokens).toEqual(["a-new", "a-new", "a-new"]);
    expect(net.sent).toHaveLength(1);
  });

  it("a revoked refresh token (invalid_grant) tells the user to sign in again", async () => {
    const { provider } = await make("r-1", () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "auth_expired", message: expect.stringMatching(/login/) });
  });

  it("a rejected client is a config problem, a Google outage is 'unavailable'", async () => {
    const bad = await make("r-1", () => ({ status: 401, body: { error: "invalid_client" } }));
    await expect(bad.provider.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
    const down = await make("r-1", () => ({ status: 503, body: {} }));
    await expect(down.provider.getAccessToken()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses a sign-in whose granted scope is not exactly read-only Gmail", async () => {
    const { provider } = await make("r-1", () => ({ body: { access_token: "x", scope: "https://mail.google.com/" } }));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("error messages never contain token or secret values", async () => {
    const { provider } = await make("r-SECRET-VALUE", () => ({ status: 400, body: { error: "invalid_grant" } }));
    const err = await provider.getAccessToken().catch((e: Error) => e);
    expect(JSON.stringify(err) + String((err as Error).message)).not.toMatch(/SECRET-VALUE|csecret/);
  });
});

describe("login (loopback + PKCE)", () => {
  /** onUrl이 받은 주소로 사용자가 승인한 것처럼 로컬 되돌림 주소를 직접 두드린다. */
  const approve = (code: string | null, stateOverride?: string) => async (url: string) => {
    const u = new URL(url);
    const back = new URL(u.searchParams.get("redirect_uri") ?? "");
    back.searchParams.set("state", stateOverride ?? u.searchParams.get("state") ?? "");
    if (code) back.searchParams.set("code", code);
    await fetch(back);
  };

  it("exchanges the code (with the PKCE verifier) and saves the refresh token to .env.local only", async () => {
    const net = fakeFetch(() => ({ body: { access_token: "a-1", refresh_token: "r-1", expires_in: 3600, scope: GMAIL_READONLY_SCOPE } }));
    const store = new TokenStore(envPath);
    const homeBefore = existsSync(join(homedir(), ".config")) ? readdirSync(join(homedir(), ".config")) : [];
    await login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve("CODE-1")(u) });
    const form = net.sent[0]!.form;
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("CODE-1");
    expect(form.get("code_verifier")?.length).toBeGreaterThan(30);
    expect(await store.read()).toBe("r-1");
    expect(readFileSync(envPath, "utf-8")).not.toContain("a-1");
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(readdirSync(dir)).toEqual([".env.local"]);
    const homeAfter = existsSync(join(homedir(), ".config")) ? readdirSync(join(homedir(), ".config")) : [];
    expect(homeAfter).toEqual(homeBefore);
  });

  it("does not save when Google granted more than read-only access", async () => {
    const net = fakeFetch(() => ({ body: { access_token: "a", refresh_token: "r", scope: `${GMAIL_READONLY_SCOPE} https://mail.google.com/` } }));
    const store = new TokenStore(envPath);
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve("C")(u) })).rejects.toMatchObject({ code: "permission_denied" });
    expect(await store.read()).toBeNull();
  });

  it("does not save when no refresh token comes back", async () => {
    const net = fakeFetch(() => ({ body: { access_token: "a", scope: GMAIL_READONLY_SCOPE } }));
    const store = new TokenStore(envPath);
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve("C")(u) })).rejects.toMatchObject({ code: "google_error" });
    expect(await store.read()).toBeNull();
  });

  it("a denied sign-in (no code) fails clearly and saves nothing", async () => {
    const net = fakeFetch(() => ({ body: {} }));
    const store = new TokenStore(envPath);
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve(null)(u) })).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
  });

  it("ignores a callback with the wrong state, then times out instead of accepting it", async () => {
    const net = fakeFetch(() => ({ body: {} }));
    const store = new TokenStore(envPath);
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, timeoutMs: 300, onUrl: (u) => void approve("EVIL", "forged")(u) })).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
    expect(await store.read()).toBeNull();
  });

  it(".env.local holds the refresh token but the tool-facing status does not", async () => {
    const store = new TokenStore(envPath);
    await store.write("r-TOPSECRET");
    expect(readFileSync(envPath, "utf-8")).toContain("r-TOPSECRET");
    expect(JSON.stringify(await new TokenProvider(store, () => CLIENT).status())).not.toContain("TOPSECRET");
  });
});
