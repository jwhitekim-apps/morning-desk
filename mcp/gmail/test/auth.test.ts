// my-task original code (not derived from upstream).
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthUrl, GMAIL_READONLY_SCOPE, login, newPkce, TokenProvider, type FetchFn } from "../src/auth/oauth";
import { loadOAuthClient, TokenStore } from "../src/auth/store";

const CLIENT = { clientId: "cid.apps.googleusercontent.com", clientSecret: "csecret" };

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gmail-mcp-test-")); });
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

const saved = (over: object = {}) => ({ refresh_token: "r-1", scope: GMAIL_READONLY_SCOPE, saved_at: "2026-01-01T00:00:00Z", ...over });

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

describe("TokenStore", () => {
  it("saves with folder 700 and file 600, replacing atomically", () => {
    const path = join(dir, "sub", "token.json");
    const store = new TokenStore(path);
    store.write(saved() as never);
    expect(statSync(join(dir, "sub")).mode & 0o777).toBe(0o700);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    store.write(saved({ refresh_token: "r-2" }) as never);
    expect(store.read()?.refresh_token).toBe("r-2");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("tightens a pre-existing folder that was too open", () => {
    const sub = join(dir, "open");
    new TokenStore(join(sub, "t.json")).write(saved() as never);
    writeFileSync(join(sub, "keep"), "");
    new TokenStore(join(sub, "t.json")).write(saved() as never);
    expect(statSync(sub).mode & 0o777).toBe(0o700);
  });

  it("reports a missing or broken file as 'sign in again', not as a crash", () => {
    const path = join(dir, "t.json");
    expect(new TokenStore(path).read()).toBeNull();
    writeFileSync(path, "{not json");
    expect(() => new TokenStore(path).read()).toThrowError(/login/);
  });
});

describe("OAuth client loading", () => {
  it("accepts the JSON downloaded from Google Cloud Console as-is", () => {
    const path = join(dir, "client.json");
    writeFileSync(path, JSON.stringify({ installed: { client_id: "a", client_secret: "b", redirect_uris: ["http://localhost"] } }));
    expect(loadOAuthClient({ clientPath: path })).toEqual({ clientId: "a", clientSecret: "b" });
  });
  it("prefers environment values", () => {
    expect(loadOAuthClient({ clientId: "x", clientSecret: "y", clientPath: join(dir, "none.json") })).toEqual({ clientId: "x", clientSecret: "y" });
  });
  it("says what to do when nothing is configured, without a stack trace", () => {
    expect(() => loadOAuthClient({ clientPath: join(dir, "none.json") })).toThrowError(/No OAuth client configured/);
  });
});

describe("TokenProvider", () => {
  const make = (over: object, respond: Parameters<typeof fakeFetch>[0], now = () => 1_000_000) => {
    const store = new TokenStore(join(dir, "t.json"));
    if (over !== null) store.write(saved(over) as never);
    const net = fakeFetch(respond);
    return { store, net, provider: new TokenProvider(store, () => CLIENT, net.fn, now) };
  };

  it("not signed in -> auth_required, without calling Google", async () => {
    const net = fakeFetch(() => ({ body: {} }));
    const provider = new TokenProvider(new TokenStore(join(dir, "none.json")), () => CLIENT, net.fn);
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
    expect(provider.status()).toEqual({ signedIn: false });
  });

  it("uses a still-valid access token without calling Google", async () => {
    const { provider, net } = make({ access_token: "a-live", expires_at: 1_000_000 + 10 * 60_000 }, () => ({ body: {} }));
    expect(await provider.getAccessToken()).toBe("a-live");
    expect(net.sent).toHaveLength(0);
  });

  it("refreshes an expired access token and saves the new one with 600", async () => {
    const { provider, net, store } = make({ access_token: "a-old", expires_at: 999_000 }, () => ({ body: { access_token: "a-new", expires_in: 3600 } }));
    expect(await provider.getAccessToken()).toBe("a-new");
    expect(net.sent[0]?.form.get("grant_type")).toBe("refresh_token");
    expect(net.sent[0]?.form.get("refresh_token")).toBe("r-1");
    expect(store.read()).toMatchObject({ access_token: "a-new", refresh_token: "r-1", expires_at: 1_000_000 + 3600_000 });
    expect(statSync(join(dir, "t.json")).mode & 0o777).toBe(0o600);
  });

  it("refreshes only once for concurrent callers", async () => {
    const { provider, net } = make({}, () => ({ body: { access_token: "a-new", expires_in: 3600 } }));
    const tokens = await Promise.all([provider.getAccessToken(), provider.getAccessToken(), provider.getAccessToken()]);
    expect(tokens).toEqual(["a-new", "a-new", "a-new"]);
    expect(net.sent).toHaveLength(1);
  });

  it("a revoked refresh token (invalid_grant) tells the user to sign in again", async () => {
    const { provider } = make({}, () => ({ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "auth_expired", message: expect.stringMatching(/login/) });
  });

  it("a rejected client is a config problem, a Google outage is 'unavailable'", async () => {
    const bad = make({}, () => ({ status: 401, body: { error: "invalid_client" } }));
    await expect(bad.provider.getAccessToken()).rejects.toMatchObject({ code: "config_error" });
    const down = make({}, () => ({ status: 503, body: {} }));
    await expect(down.provider.getAccessToken()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("refuses a saved sign-in whose scope is not exactly read-only Gmail", async () => {
    const { provider } = make({ scope: "https://mail.google.com/" }, () => ({ body: { access_token: "x" } }));
    await expect(provider.getAccessToken()).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("error messages never contain token or secret values", async () => {
    const { provider } = make({ refresh_token: "r-SECRET-VALUE" }, () => ({ status: 400, body: { error: "invalid_grant" } }));
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

  it("exchanges the code (with the PKCE verifier) and saves a 600 token with only the read-only scope", async () => {
    const net = fakeFetch(() => ({ body: { access_token: "a-1", refresh_token: "r-1", expires_in: 3600, scope: GMAIL_READONLY_SCOPE } }));
    const store = new TokenStore(join(dir, "t.json"));
    await login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve("CODE-1")(u) });
    const form = net.sent[0]!.form;
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("CODE-1");
    expect(form.get("code_verifier")?.length).toBeGreaterThan(30);
    expect(store.read()).toMatchObject({ refresh_token: "r-1", scope: GMAIL_READONLY_SCOPE });
    expect(statSync(join(dir, "t.json")).mode & 0o777).toBe(0o600);
  });

  it("does not save when Google granted more than read-only access", async () => {
    const net = fakeFetch(() => ({ body: { access_token: "a", refresh_token: "r", scope: `${GMAIL_READONLY_SCOPE} https://mail.google.com/` } }));
    const store = new TokenStore(join(dir, "t.json"));
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve("C")(u) })).rejects.toMatchObject({ code: "permission_denied" });
    expect(store.read()).toBeNull();
  });

  it("does not save when no refresh token comes back", async () => {
    const net = fakeFetch(() => ({ body: { access_token: "a", scope: GMAIL_READONLY_SCOPE } }));
    const store = new TokenStore(join(dir, "t.json"));
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve("C")(u) })).rejects.toMatchObject({ code: "google_error" });
    expect(store.read()).toBeNull();
  });

  it("a denied sign-in (no code) fails clearly and saves nothing", async () => {
    const net = fakeFetch(() => ({ body: {} }));
    const store = new TokenStore(join(dir, "t.json"));
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, onUrl: (u) => void approve(null)(u) })).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
  });

  it("ignores a callback with the wrong state, then times out instead of accepting it", async () => {
    const net = fakeFetch(() => ({ body: {} }));
    const store = new TokenStore(join(dir, "t.json"));
    await expect(login({ store, client: CLIENT, fetchFn: net.fn, timeoutMs: 300, onUrl: (u) => void approve("EVIL", "forged")(u) })).rejects.toMatchObject({ code: "auth_required" });
    expect(net.sent).toHaveLength(0);
    expect(store.read()).toBeNull();
  });

  it("the token file contains the refresh token but the tool-facing status does not", async () => {
    const store = new TokenStore(join(dir, "t.json"));
    store.write(saved({ refresh_token: "r-TOPSECRET" }) as never);
    expect(readFileSync(join(dir, "t.json"), "utf-8")).toContain("r-TOPSECRET");
    expect(JSON.stringify(new TokenProvider(store, () => CLIENT).status())).not.toContain("TOPSECRET");
  });
});
