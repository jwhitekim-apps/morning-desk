// my-task original code (not derived from upstream).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "../src/logger";
import { VelooApi } from "../src/veloo/api";
import { VelooClient, type FetchFn } from "../src/veloo/client";
import { SessionStore } from "../src/veloo/session";

export const USERNAME = "veloo-user-secret-name";
export const PASSWORD = "veloo-password-SECRET-0001";
export const COOKIE = "access_token=SESSION-COOKIE-SECRET-0002";
export const BASE = "https://veloo.example.com";

export interface Req { method: string; path: string; search: string; headers: Record<string, string>; body: string }
export type Handler = (req: Req) => Response | Error | undefined;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
export const loginOk = (cookie = COOKIE) => json({ ok: true }, 200, { "set-cookie": `${cookie}; HttpOnly; Path=/; Max-Age=2592000; SameSite=lax` });

export const task = (id: number, over: Record<string, unknown> = {}) => ({
  id,
  name: `태스크 ${id}`,
  memo: "",
  priority: "normal",
  deadline: "",
  done: false,
  created_at: "2026-10-01T00:30:00+00:00",
  ...over,
});

export function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), "veloo-mcp-test-"));
  return { dir, path: join(dir, ".env.local"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** 벨루를 흉내 낸다. 요청을 기록한다. 로그인(POST /login)의 기본 응답은 성공이다. */
export function setup(handler: Handler, over: { baseUrl?: string | undefined; username?: string | undefined; password?: string | undefined; sessionPath: string; now?: () => number }) {
  const requests: Req[] = [];
  const fetchFn: FetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const req = { method: init?.method ?? "GET", path: url.pathname, search: url.search, headers: (init?.headers ?? {}) as Record<string, string>, body: String(init?.body ?? "") };
    requests.push(req);
    const out = handler(req);
    if (out instanceof Error) throw out;
    if (out) return out;
    if (req.method === "POST" && req.path === "/login") return loginOk();
    return json([]);
  }) as FetchFn;
  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const store = new SessionStore(over.sessionPath);
  const client = new VelooClient(logger, {
    baseUrl: "baseUrl" in over ? over.baseUrl : BASE,
    username: "username" in over ? over.username : USERNAME,
    password: "password" in over ? over.password : PASSWORD,
    store,
    fetchFn,
    now: over.now,
  });
  return { api: new VelooApi(client, logger), client, store, requests, lines, logger, gets: () => requests.filter((r) => r.method === "GET"), logins: () => requests.filter((r) => r.path === "/login") };
}
