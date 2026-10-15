// my-task original code (not derived from upstream).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { DEFAULT_LIMIT, escapeForRegex, FolioApi, MAX_LIMIT, parseSince, SYNCED_AT_NOTE, type FetchFn } from "../src/folio/api";
import { createLogger } from "@morning-desk/shared";

interface Req { method: string; url: URL; headers: Record<string, string> }

/** PostgREST를 흉내 낸다. 요청을 기록하고 준비한 응답을 순서대로 돌려준다. */
function setup(responses: (Response | Error)[] = [], over: { url?: string; key?: string; table?: string } = {}) {
  const requests: Req[] = [];
  let i = 0;
  const fetchFn: FetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ method: init?.method ?? "GET", url: new URL(String(input)), headers: init?.headers as Record<string, string> });
    const r = responses[i++] ?? rows([]);
    if (r instanceof Error) throw r;
    return r;
  }) as FetchFn;
  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const waits: number[] = [];
  const api = new FolioApi(logger, { url: "https://proj.supabase.co", key: "KEY-1", table: "folio_papers", fetchFn, sleep: async (ms) => void waits.push(ms), ...over });
  return { api, requests, waits, lines };
}
const rows = (data: unknown[]) => new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
const status = (s: number, body: object = {}, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: s, headers });
const paper = (key: string, title: string | null, synced: string, year: string | number | null = 2024) => ({ item_key: key, title, year, synced_at: synced });

describe("list_recent_papers", () => {
  it("returns papers newest-synced first with Korea-time syncedAt and the note", async () => {
    const { api, requests } = setup([rows([paper("A", "Attention Is All You Need", "2026-10-09T15:30:00+00:00"), paper("B", "BERT", "2026-10-08T00:00:00Z", "2019")])]);
    const r = await api.listRecent({ since: "2026-10-03" });
    expect(r.items).toEqual([
      { itemKey: "A", title: "Attention Is All You Need", year: 2024, syncedAt: "2026-10-10T00:30:00+09:00" },
      { itemKey: "B", title: "BERT", year: "2019", syncedAt: "2026-10-08T09:00:00+09:00" },
    ]);
    expect(r.note).toBe(SYNCED_AT_NOTE);
    expect(r.truncated).toBe(false);
    const q = requests[0]!.url.searchParams;
    expect(q.get("order")).toBe("synced_at.desc");
    expect(q.get("select")).toBe("item_key,title,year,synced_at");
    expect(q.get("synced_at")).toBe("gte.2026-10-02T15:00:00.000Z"); // 날짜만 = 한국 자정
  });

  it("sends no since filter when none is given", async () => {
    const { api, requests } = setup();
    await api.listRecent();
    expect(requests[0]!.url.searchParams.has("synced_at")).toBe(false);
    expect(requests[0]!.url.searchParams.get("limit")).toBe(String(DEFAULT_LIMIT + 1));
  });

  it("shows '(제목 없음)' for an empty or missing title", async () => {
    const { api } = setup([rows([paper("A", "", "2026-10-09T00:00:00Z"), paper("B", null, "2026-10-08T00:00:00Z"), paper("C", "   ", "2026-10-07T00:00:00Z")])]);
    expect((await api.listRecent()).items.map((p) => p.title)).toEqual(["(제목 없음)", "(제목 없음)", "(제목 없음)"]);
  });

  it("when there are more rows than the limit it returns the limit and flags truncation", async () => {
    const many = Array.from({ length: 4 }, (_, i) => paper(`K${i}`, `t${i}`, "2026-10-09T00:00:00Z"));
    const { api, requests } = setup([rows(many)]);
    const r = await api.listRecent({ maxResults: 3 });
    expect(r.items).toHaveLength(3);
    expect(r.truncated).toBe(true);
    expect(requests[0]!.url.searchParams.get("limit")).toBe("4"); // 하나 더 달라고 해서 더 있는지 안다
  });

  it("exactly the limit is not truncated", async () => {
    const { api } = setup([rows(Array.from({ length: 3 }, (_, i) => paper(`K${i}`, "t", "2026-10-09T00:00:00Z")))]);
    expect((await api.listRecent({ maxResults: 3 })).truncated).toBe(false);
  });

  it("clamps the limit to 1..500", async () => {
    const { api, requests } = setup();
    await api.listRecent({ maxResults: 99999 });
    await api.listRecent({ maxResults: 0 });
    expect(requests.map((r) => r.url.searchParams.get("limit"))).toEqual([String(MAX_LIMIT + 1), "2"]);
  });
});

describe("parseSince", () => {
  it("date only = Korea midnight, no zone = Korea time, explicit zone honoured", () => {
    expect(parseSince("2026-10-13")).toBe("2026-10-12T15:00:00.000Z");
    expect(parseSince("2026-10-13T09:30")).toBe("2026-10-13T00:30:00.000Z");
    expect(parseSince("2026-10-13T09:30:00Z")).toBe("2026-10-13T09:30:00.000Z");
    expect(parseSince("2026-10-13T09:30:00-0500")).toBe("2026-10-13T14:30:00.000Z");
  });
  it("rejects nonsense and impossible dates before any request", async () => {
    for (const bad of ["어제", "2026-13-01", "2026-02-30", "2026-10-13T25:00", ""]) expect(() => parseSince(bad), bad).toThrowError(/Invalid since/);
    const { api, requests } = setup();
    await expect(api.listRecent({ since: "2026-02-30" })).rejects.toMatchObject({ code: "validation_error" });
    expect(requests).toHaveLength(0);
  });
});

describe("search_papers", () => {
  it("matches the text as a case-insensitive regex of the escaped term", async () => {
    const { api, requests } = setup([rows([paper("A", "Attention Is All You Need", "2026-10-09T00:00:00Z")])]);
    const r = await api.search({ query: "attention" });
    expect(r.items.map((p) => p.title)).toEqual(["Attention Is All You Need"]);
    expect(requests[0]!.url.searchParams.get("title")).toBe("imatch.attention");
  });

  it("escapes every special character so it is searched literally, and the URL stays intact", async () => {
    const term = "50% a*b, (c) [d] x.y | $ ^ \\ _ + ? { }";
    const { api, requests } = setup();
    await api.search({ query: term });
    const sent = requests[0]!.url.searchParams.get("title")!;
    expect(sent.startsWith("imatch.")).toBe(true);
    const regex = new RegExp(sent.slice("imatch.".length), "i");
    expect(regex.test(`xx ${term} yy`)).toBe(true); // 같은 글자가 있으면 찾고
    expect(regex.test("50 aab c d xzy")).toBe(false); // 특수문자가 의미를 갖지 않는다
    expect(requests[0]!.url.searchParams.get("select")).toBe("item_key,title,year,synced_at"); // 다른 조건이 깨지지 않음
    expect(requests[0]!.url.searchParams.getAll("title")).toHaveLength(1);
  });

  it.each(["%", "*", ",", ")"])("the single character %s is escaped and searches only for itself", async (ch) => {
    const { api, requests } = setup();
    await api.search({ query: ch });
    const re = new RegExp(requests[0]!.url.searchParams.get("title")!.slice(7), "i");
    expect(re.test(`a${ch}b`)).toBe(true);
    expect(re.test("ab")).toBe(false);
    expect(re.test("a b")).toBe(false);
  });

  it("keeps Korean and spaces as they are", () => {
    expect(escapeForRegex("딥러닝 기반 (survey)")).toBe("딥러닝 기반 \\(survey\\)");
  });

  it("rejects an empty or very long search text without calling the database", async () => {
    const { api, requests } = setup();
    await expect(api.search({ query: "   " })).rejects.toMatchObject({ code: "validation_error" });
    await expect(api.search({ query: "가".repeat(101) })).rejects.toMatchObject({ code: "validation_error" });
    expect(requests).toHaveLength(0);
  });
});

describe("failures are told apart", () => {
  const code = async (r: Response | Error) => setup([r]).api.listRecent().catch((e: AppError) => e);

  it("wrong key -> auth_failed (401 and 403)", async () => {
    expect(await code(status(401, { message: "Invalid API key" }))).toMatchObject({ code: "auth_failed" });
    expect(await code(status(403))).toMatchObject({ code: "auth_failed" });
  });

  it("missing table -> table_not_found, different from auth_failed", async () => {
    expect(await code(status(404, { code: "PGRST205" }))).toMatchObject({ code: "table_not_found" });
    expect(await code(status(400, { code: "42P01" }))).toMatchObject({ code: "table_not_found" });
  });

  it("server trouble -> unavailable after retries; network failure too", async () => {
    const s = setup([status(503), status(503), status(503)]);
    await expect(s.api.listRecent()).rejects.toMatchObject({ code: "unavailable" });
    expect(s.requests).toHaveLength(3);
    const n = setup([new Error("ECONNRESET host.example"), new Error("x"), new Error("y")]);
    const err = await n.api.listRecent().catch((e: AppError) => e);
    expect(err).toMatchObject({ code: "unavailable" });
    expect(JSON.stringify(err)).not.toContain("host.example");
  });

  it("retries a 429 honouring Retry-After, then succeeds", async () => {
    const s = setup([status(429, {}, { "retry-after": "2" }), rows([paper("A", "t", "2026-10-09T00:00:00Z")])]);
    expect((await s.api.listRecent()).items).toHaveLength(1);
    expect(s.waits).toEqual([2000]);
  });

  it("a persistent 429 -> rate_limited with the wait", async () => {
    const s = setup([status(429, {}, { "retry-after": "30" }), status(429, {}, { "retry-after": "30" }), status(429, {}, { "retry-after": "30" })]);
    await expect(s.api.listRecent()).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 30 });
  });

  it("does not retry a 401", async () => {
    const s = setup([status(401), rows([])]);
    await expect(s.api.listRecent()).rejects.toMatchObject({ code: "auth_failed" });
    expect(s.requests).toHaveLength(1);
  });

  it("a row missing item_key or synced_at is reported as a changed table, not skipped", async () => {
    await expect(setup([rows([{ title: "no key", synced_at: "2026-10-09T00:00:00Z" }])]).api.listRecent()).rejects.toMatchObject({ code: "upstream_error" });
    await expect(setup([rows([{ item_key: "A", title: "t" }])]).api.listRecent()).rejects.toMatchObject({ code: "upstream_error" });
    await expect(setup([rows([paper("A", "t", "not a date")])]).api.listRecent()).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("a non-array body is a changed-structure error", async () => {
    await expect(setup([new Response(JSON.stringify({ message: "hi" }), { status: 200 })]).api.listRecent()).rejects.toMatchObject({ code: "upstream_error" });
  });

  it("never echoes the database's error text", async () => {
    const err = await code(status(400, { message: "논문 제목 비밀 포함 문장", code: "XX000" }));
    expect(JSON.stringify(err)).not.toContain("비밀");
  });

  it("each case has its own code", async () => {
    const codes = await Promise.all([status(401), status(404, { code: "PGRST205" }), status(400), status(418)].map(async (r) => (await code(r) as AppError).code));
    expect(new Set(codes).size).toBe(4);
  });
});

describe("configuration", () => {
  it("missing url or key is a config error and nothing is sent", async () => {
    const a = setup([], { url: undefined });
    await expect(a.api.listRecent()).rejects.toMatchObject({ code: "config_error" });
    const b = setup([], { key: undefined });
    await expect(b.api.listRecent()).rejects.toMatchObject({ code: "config_error" });
    expect(a.requests.length + b.requests.length).toBe(0);
  });

  it("refuses to send the key over plain http (except localhost)", async () => {
    const s = setup([], { url: "http://proj.supabase.co" });
    await expect(s.api.listRecent()).rejects.toMatchObject({ code: "config_error" });
    expect(s.requests).toHaveLength(0);
    const local = setup([rows([])], { url: "http://localhost:54321" });
    await expect(local.api.listRecent()).resolves.toMatchObject({ items: [] });
  });

  it("rejects a table name that is not a plain identifier", async () => {
    const s = setup([], { table: "folio_papers?select=*&x=" });
    await expect(s.api.listRecent()).rejects.toMatchObject({ code: "config_error" });
    expect(s.requests).toHaveLength(0);
  });

  it("sends the key as apikey and bearer to /rest/v1/<table>", async () => {
    const { api, requests } = setup();
    await api.listRecent();
    expect(requests[0]!.url.pathname).toBe("/rest/v1/folio_papers");
    expect(requests[0]!.headers.apikey).toBe("KEY-1");
    expect(requests[0]!.headers.Authorization).toBe("Bearer KEY-1");
  });
});

describe("the synced-at limitation is stated", () => {
  it("the module's documentation says syncedAt is a sync time and not enough to call a paper new", () => {
    const doc = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8");
    expect(doc).toMatch(/마지막으로 \*\*동기화된\*\* 시각이고 처음 저장한 시각이 아니다/);
    expect(doc).toMatch(/그것만으로 "새 논문"이라고 판단하지 않는다/);
    expect(SYNCED_AT_NOTE).toMatch(/SYNCED from Zotero, not when it was first saved/);
    expect(SYNCED_AT_NOTE).toMatch(/not evidence that a paper is new/);
  });
  it("every response carries the note", async () => {
    const { api } = setup([rows([]), rows([])]);
    expect((await api.listRecent()).note).toBe(SYNCED_AT_NOTE);
    expect((await api.search({ query: "x" })).note).toBe(SYNCED_AT_NOTE);
  });
});
