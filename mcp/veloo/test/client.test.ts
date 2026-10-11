// my-task original code (not derived from upstream).
import { statSync } from "node:fs";
import { dirname } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BASE, COOKIE, json, loginOk, makeDir, PASSWORD, setup, task, USERNAME, type Req } from "./helpers";

let d: ReturnType<typeof makeDir>;
beforeEach(() => { d = makeDir(); });
afterEach(() => { d.cleanup(); });

const todos = (r: Req) => (r.path === "/todo/api/todos" ? json([task(1)]) : undefined);

describe("login and session reuse", () => {
  it("logs in once with the account, saves the session with folder 700 / file 600, and sends it as a cookie", async () => {
    const s = setup(todos, { sessionPath: d.path });
    await s.api.listTasks();
    expect(s.logins()).toHaveLength(1);
    expect(s.logins()[0]!.method).toBe("POST");
    expect(JSON.parse(s.logins()[0]!.body)).toEqual({ username: USERNAME, password: PASSWORD });
    expect(s.gets()[0]!.headers.cookie).toBe(COOKIE);
    expect(statSync(d.path).mode & 0o777).toBe(0o600);
    expect(statSync(dirname(d.path)).mode & 0o777).toBe(0o700);
  });

  it("the account is never sent with a data request, only with the login", async () => {
    const s = setup(todos, { sessionPath: d.path });
    await s.api.listTasks();
    for (const r of s.gets()) expect(JSON.stringify(r)).not.toContain(PASSWORD);
  });

  it("a second read does not log in again", async () => {
    const s = setup(todos, { sessionPath: d.path });
    await s.api.listTasks();
    await s.api.listTasks();
    expect(s.logins()).toHaveLength(1);
    expect(s.gets()).toHaveLength(2);
  });

  it("a saved session is reused by a new process, with no login at all", async () => {
    const first = setup(todos, { sessionPath: d.path });
    await first.api.listTasks();
    const second = setup(todos, { sessionPath: d.path });
    await second.api.listTasks();
    expect(second.logins()).toHaveLength(0);
    expect(second.gets()[0]!.headers.cookie).toBe(COOKIE);
  });

  it("concurrent first calls log in only once", async () => {
    const s = setup(todos, { sessionPath: d.path });
    await Promise.all([s.api.listTasks(), s.api.listTasks(), s.api.listTasks()]);
    expect(s.logins()).toHaveLength(1);
  });
});

describe("expired session", () => {
  it("a 401 triggers exactly one new login and one retry, then returns the result", async () => {
    let n = 0;
    const s = setup((r) => (r.path === "/todo/api/todos" ? (++n === 1 ? json({ detail: "세션이 만료됐습니다." }, 401) : json([task(7)])) : undefined), { sessionPath: d.path });
    s.store.write("access_token=OLD-SESSION");
    const r = await s.api.listTasks();
    expect(r.items.map((t) => t.id)).toEqual([7]);
    expect(s.requests.map((q) => `${q.method} ${q.path}`)).toEqual(["GET /todo/api/todos", "POST /login", "GET /todo/api/todos"]);
    expect(s.gets()[0]!.headers.cookie).toBe("access_token=OLD-SESSION");
    expect(s.gets()[1]!.headers.cookie).toBe(COOKIE);
  });

  it("a redirect to the login page counts as an expired session too", async () => {
    let n = 0;
    const s = setup((r) => (r.path === "/todo/api/todos" ? (++n === 1 ? new Response(null, { status: 302, headers: { location: "/login" } }) : json([task(1)])) : undefined), { sessionPath: d.path });
    s.store.write("access_token=OLD");
    await expect(s.api.listTasks()).resolves.toMatchObject({ items: [{ id: 1 }] });
    expect(s.logins()).toHaveLength(1);
  });

  it("if the retry after a new login is also rejected it gives up instead of looping", async () => {
    const s = setup((r) => (r.path === "/todo/api/todos" ? json({}, 401) : undefined), { sessionPath: d.path });
    s.store.write("access_token=OLD-SESSION");
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "auth_failed" });
    expect(s.logins()).toHaveLength(1);
    expect(s.gets()).toHaveLength(2);
  });

  it("a session that was just created and is still rejected is not renewed again (no pointless extra sessions)", async () => {
    const s = setup((r) => (r.path === "/todo/api/todos" ? json({}, 401) : undefined), { sessionPath: d.path });
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "auth_failed" });
    expect(s.logins()).toHaveLength(1);
    expect(s.gets()).toHaveLength(1);
  });
});

describe("failed login", () => {
  const rejecting = (status: number) => (r: Req) => (r.path === "/login" ? json({ error: "사용자명 또는 비밀번호가 틀렸습니다." }, status) : undefined);

  it("wrong account: auth_failed, no retry within the call", async () => {
    const s = setup(rejecting(401), { sessionPath: d.path });
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "auth_failed" });
    expect(s.logins()).toHaveLength(1);
    expect(s.gets()).toHaveLength(0);
  });

  it("does not try to log in again for 15 minutes, so the server does not lock the account", async () => {
    let now = 1_000_000;
    const s = setup(rejecting(401), { sessionPath: d.path, now: () => now });
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "auth_failed" });
    for (let i = 0; i < 6; i++) await expect(s.api.listTasks()).rejects.toMatchObject({ code: "auth_failed" });
    expect(s.logins()).toHaveLength(1); // 5번 틀리면 잠기므로, 반복 호출에도 로그인 요청은 한 번뿐
    now += 15 * 60_000 + 1;
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "auth_failed" });
    expect(s.logins()).toHaveLength(2); // 15분 뒤에는 다시 시도한다
  });

  it("an unapproved account is permission_denied, a lockout is rate_limited with the wait", async () => {
    await expect(setup(rejecting(403), { sessionPath: d.path }).api.listTasks()).rejects.toMatchObject({ code: "permission_denied" });
    await expect(setup(rejecting(429), { sessionPath: d.path }).api.listTasks()).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 900 });
  });

  it("a server error during login is 'unavailable' and does not start the cool-down", async () => {
    let fail = true;
    const s = setup((r) => (r.path === "/login" && fail ? json({}, 503) : todos(r)), { sessionPath: d.path });
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "unavailable" });
    fail = false;
    await expect(s.api.listTasks()).resolves.toMatchObject({ items: [{ id: 1 }] });
    expect(s.logins()).toHaveLength(2);
  });

  it("a login that returns no session cookie is a contract change", async () => {
    const s = setup((r) => (r.path === "/login" ? json({ ok: true }) : undefined), { sessionPath: d.path });
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "contract_changed" });
  });

  it("error messages never contain the account", async () => {
    const err = await setup(rejecting(401), { sessionPath: d.path }).api.listTasks().catch((e: Error) => e);
    expect(JSON.stringify(err) + String((err as Error).message)).not.toMatch(new RegExp(`${USERNAME}|${PASSWORD}`));
  });
});

describe("configuration and connectivity", () => {
  it("missing settings are a config error and nothing is sent", async () => {
    for (const over of [{ baseUrl: undefined }, { username: undefined }, { password: undefined }]) {
      const s = setup(todos, { sessionPath: d.path, ...over });
      await expect(s.api.listTasks()).rejects.toMatchObject({ code: "config_error" });
      expect(s.requests).toHaveLength(0);
    }
  });

  it("refuses to send the password over plain http (except localhost)", async () => {
    const s = setup(todos, { sessionPath: d.path, baseUrl: "http://veloo.example.com" });
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "config_error" });
    expect(s.requests).toHaveLength(0);
    await expect(setup(todos, { sessionPath: d.path, baseUrl: "http://localhost:8000" }).api.listTasks()).resolves.toBeDefined();
  });

  it("an unreachable server is 'unavailable', clearly different from a changed response format", async () => {
    const down = setup(() => new Error("ECONNREFUSED veloo.example.com"), { sessionPath: d.path });
    const err = await down.api.listTasks().catch((e: Error) => e);
    expect(err).toMatchObject({ code: "unavailable" });
    expect(String((err as Error).message)).not.toContain("ECONNREFUSED");
    const changed = setup((r) => (r.path === "/todo/api/todos" ? json({ not: "an array" }) : undefined), { sessionPath: d.path });
    await expect(changed.api.listTasks()).rejects.toMatchObject({ code: "contract_changed" });
  });

  it("a 5xx on a read is 'unavailable'; a 404 means the endpoint moved (contract change)", async () => {
    await expect(setup((r) => (r.path === "/todo/api/todos" ? json({}, 503) : undefined), { sessionPath: d.path }).api.listTasks()).rejects.toMatchObject({ code: "unavailable" });
    await expect(setup((r) => (r.path === "/todo/api/todos" ? json({}, 404) : undefined), { sessionPath: d.path }).api.listTasks()).rejects.toMatchObject({ code: "contract_changed" });
  });

  it("uses the configured base address", async () => {
    const s = setup(todos, { sessionPath: d.path });
    await s.api.listTasks();
    expect(BASE).toContain("veloo.example.com");
    expect(s.requests.every((r) => r.path.startsWith("/"))).toBe(true);
  });

  it("status reports configured and saved-session without any value", async () => {
    const s = setup(todos, { sessionPath: d.path });
    expect(s.api.status()).toEqual({ configured: true, savedSession: false });
    await s.api.listTasks();
    expect(s.api.status()).toEqual({ configured: true, savedSession: true });
    expect(setup(todos, { sessionPath: d.path, password: undefined }).api.status().configured).toBe(false);
    void loginOk;
  });
});
