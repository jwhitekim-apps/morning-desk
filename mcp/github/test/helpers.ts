// my-task original code (not derived from upstream).
import { GithubApi } from "../src/github/api";
import { GithubClient, type FetchFn } from "../src/github/client";
import { createLogger } from "../src/logger";

export interface Req { method: string; url: URL; headers: Record<string, string> }
export type Handler = (req: Req) => Response | Error | undefined;

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

export const SEARCH_TOKEN = "github_pat_SEARCH-TOKEN-SECRET-0001";
export const NOTIF_TOKEN = "ghp_NOTIFICATIONS-TOKEN-SECRET-0002";

/** GitHub를 흉내 낸다. `/user`는 기본으로 `me`를 돌려준다. 요청을 기록한다. */
export function setup(handler: Handler, over: { token?: string | null; notificationsToken?: string | null; repos?: string[]; now?: number } = {}) {
  const requests: Req[] = [];
  const waits: number[] = [];
  const fetchFn: FetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const req = { method: init?.method ?? "GET", url: new URL(String(input)), headers: init?.headers as Record<string, string> };
    requests.push(req);
    const out = handler(req);
    if (out instanceof Error) throw out;
    if (out) return out;
    if (req.url.pathname === "/user") return json({ login: "me" });
    // 실제 GitHub의 규칙: 이슈 검색 쿼리에는 is:issue 또는 is:pr이 반드시 있어야 한다(없으면 422).
    if (req.url.pathname === "/search/issues" && !/\bis:(issue|pr|pull-request)\b/.test(req.url.searchParams.get("q") ?? "")) {
      return json({ message: "Query must include 'is:issue' or 'is:pull-request'" }, 422);
    }
    return json({});
  }) as FetchFn;
  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const client = new GithubClient(logger, {
    token: over.token === null ? undefined : (over.token ?? SEARCH_TOKEN),
    notificationsToken: over.notificationsToken === null ? undefined : (over.notificationsToken ?? NOTIF_TOKEN),
    fetchFn,
    sleep: async (ms) => void waits.push(ms),
    now: () => over.now ?? 1_800_000_000_000,
  });
  return { api: new GithubApi(client, logger, over.repos ?? []), client, requests, waits, lines, logger };
}

export const issue = (n: number, over: Record<string, unknown> = {}) => ({
  number: n,
  title: `제목 ${n}`,
  html_url: `https://github.com/o/r/pull/${n}`,
  updated_at: "2026-10-10T00:30:00Z",
  repository_url: "https://api.github.com/repos/o/r",
  user: { login: "author" },
  ...over,
});
export const search = (items: unknown[], total = items.length) => json({ total_count: total, incomplete_results: false, items });
