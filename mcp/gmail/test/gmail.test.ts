// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import type { FetchFn } from "../src/auth/oauth";
import { AppError } from "../src/errors";
import { BODY_LIMIT, GmailApi, UNTRUSTED_NOTICE } from "../src/gmail/api";
import { GmailClient, mapGoogleError } from "../src/gmail/client";
import { decodeEncodedWords, extractBody, htmlToText, truncateText } from "../src/gmail/mime";
import { createLogger } from "../src/logger";

const b64 = (text: string | Buffer) => Buffer.from(text).toString("base64url");
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

interface Req { path: string; query: URLSearchParams }

/** Gmail을 흉내 낸다. 경로별로 응답을 정하고, 받은 요청을 기록한다. */
function fakeGmail(route: (req: Req) => Response | object | Error) {
  const requests: Req[] = [];
  const fetchFn: FetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const req = { path: url.pathname.replace("/gmail/v1/users/me", ""), query: url.searchParams };
    requests.push(req);
    const out = route(req);
    if (out instanceof Error) throw out;
    return out instanceof Response ? out : json(out);
  }) as FetchFn;
  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const client = new GmailClient({ getAccessToken: async () => "tok" }, logger, { fetchFn, sleep: async () => undefined });
  return { api: new GmailApi(client, logger), client, requests, lines };
}

const hdr = (subject: string, from = "a@example.com") => [
  { name: "Subject", value: subject },
  { name: "From", value: from },
  { name: "Date", value: "Sat, 10 Oct 2026 09:00:00 +0900" },
];
const meta = (id: string, threadId: string, subject: string, internalDate: string, snippet = "미리보기") => ({
  id, threadId, snippet, internalDate, payload: { headers: hdr(subject) },
});

describe("search_emails", () => {
  const T0 = Date.UTC(2026, 9, 10, 0, 0); // 2026-10-10 09:00 KST
  const msgs: Record<string, ReturnType<typeof meta>> = {
    m1: meta("m1", "t1", "학회 안내", String(T0 - 3 * 86400_000)),
    m2: meta("m2", "t2", "교수님 면담", String(T0)),
    m3: meta("m3", "t1", "[추가 사항 확인 요망] 학회 안내", String(T0 - 86400_000)),
  };
  const route = (req: Req) => {
    if (req.path === "/messages") return { messages: [{ id: "m1", threadId: "t1" }, { id: "m2", threadId: "t2" }, { id: "m3", threadId: "t1" }] };
    const m = /^\/messages\/(.+)$/.exec(req.path);
    if (m) return msgs[m[1]!]!;
    const t = /^\/threads\/(.+)$/.exec(req.path);
    if (t) {
      return { messages: t[1] === "t1" ? [msgs.m3, msgs.m1].map((x) => ({ id: x!.id, internalDate: x!.internalDate, payload: x!.payload })) : [{ id: "m2", internalDate: msgs.m2!.internalDate, payload: msgs.m2!.payload }] };
    }
    return new Response("{}", { status: 500 });
  };
  const m1 = msgs.m1!;

  it("returns summaries newest first, with Korea-time dates", async () => {
    const { api } = fakeGmail(route);
    const r = await api.search({ query: "학회 OR 교수", days: 2 });
    expect(r.items.map((i) => i.id)).toEqual(["m2", "m3", "m1"]);
    expect(r.items[0]).toMatchObject({ subject: "교수님 면담", from: "a@example.com", date: "2026-10-10T09:00:00+09:00", snippet: "미리보기" });
    expect(r.notice).toBe(UNTRUSTED_NOTICE);
    expect(r.truncated).toBe(false);
  });

  it("builds the Gmail query from the search text and the day window", async () => {
    const { api, requests } = fakeGmail(route);
    await api.search({ query: "학회 OR 교수", days: 2, maxResults: 7 });
    const list = requests.find((r) => r.path === "/messages")!;
    expect(list.query.get("q")).toBe("학회 OR 교수 newer_than:2d");
    expect(list.query.get("maxResults")).toBe("7");
  });

  it("a follow-up mail carries the subject of the first mail in its thread", async () => {
    const { api } = fakeGmail(route);
    const r = await api.search({ query: "학회" });
    const followUp = r.items.find((i) => i.id === "m3")!;
    expect(followUp.subject).toBe("[추가 사항 확인 요망] 학회 안내");
    expect(followUp.threadSubject).toBe("학회 안내");
  });

  it("looks up each thread once, even when three mails share it", async () => {
    const three = { messages: ["a", "b", "c"].map((id) => ({ id, threadId: "T" })) };
    const { api, requests } = fakeGmail((req) => {
      if (req.path === "/messages") return three;
      if (req.path.startsWith("/messages/")) return meta(req.path.slice(10), "T", "같은 스레드", "1000");
      return { messages: [{ id: "a", internalDate: "1000", payload: { headers: hdr("원본") } }] };
    });
    const r = await api.search({ query: "x" });
    expect(requests.filter((q) => q.path.startsWith("/threads/"))).toHaveLength(1);
    expect(r.items.every((i) => i.threadSubject === "원본")).toBe(true);
  });

  it("when a thread lookup fails the summary still comes back and says the subject is unavailable", async () => {
    const { api } = fakeGmail((req) => {
      if (req.path === "/messages") return { messages: [{ id: "m1", threadId: "t1" }] };
      if (req.path.startsWith("/messages/")) return m1;
      return new Response(JSON.stringify({ error: { code: 404 } }), { status: 404 });
    });
    const r = await api.search({ query: "x" });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: "m1", subject: "학회 안내", threadSubjectUnavailable: true });
    expect(r.items[0]).not.toHaveProperty("threadSubject");
  });

  it("no match is an empty list, not an error", async () => {
    const { api, requests } = fakeGmail(() => ({ resultSizeEstimate: 0 }));
    expect(await api.search({ query: "없는 말" })).toMatchObject({ items: [], truncated: false });
    expect(requests).toHaveLength(1);
  });

  it("flags truncation when Gmail has more pages than the limit", async () => {
    const { api } = fakeGmail((req) => (req.path === "/messages" ? { messages: [{ id: "m1", threadId: "t1" }], nextPageToken: "more" } : req.path.startsWith("/threads/") ? { messages: [] } : m1));
    expect((await api.search({ query: "x", maxResults: 1 })).truncated).toBe(true);
  });

  it("clamps the limit to 1..100", async () => {
    const { api, requests } = fakeGmail(() => ({}));
    await api.search({ query: "x", maxResults: 5000 });
    await api.search({ query: "x", maxResults: 0 });
    expect(requests.map((r) => r.query.get("maxResults"))).toEqual(["100", "1"]);
  });

  it("decodes RFC 2047 subjects and HTML entities in snippets", async () => {
    const encoded = `=?UTF-8?B?${Buffer.from("한글 제목").toString("base64")}?=`;
    const { api } = fakeGmail((req) =>
      req.path === "/messages" ? { messages: [{ id: "m9", threadId: "t9" }] } : req.path.startsWith("/threads/") ? { messages: [] } : { ...meta("m9", "t9", encoded, "5", "it&#39;s &amp; ok") },
    );
    const r = await api.search({ query: "x" });
    expect(r.items[0]).toMatchObject({ subject: "한글 제목", snippet: "it's & ok" });
  });
});

describe("read_email", () => {
  const msg = (payload: object) => ({ id: "m1", threadId: "t1", internalDate: String(Date.UTC(2026, 9, 10)), payload: { headers: [...hdr("제목"), { name: "To", value: "me@example.com" }], ...payload } });
  const read = async (payload: object) => fakeGmail(() => msg(payload)).api.read("m1");
  const plain = (text: string, extra: object = {}) => ({ mimeType: "text/plain", body: { data: b64(text) }, ...extra });
  const html = (text: string) => ({ mimeType: "text/html", body: { data: b64(text) } });

  it("prefers the plain text part of a nested multipart mail", async () => {
    const r = await read({
      mimeType: "multipart/mixed",
      parts: [
        { mimeType: "multipart/alternative", parts: [plain("일반 텍스트 본문"), html("<p>HTML 본문</p>")] },
        { mimeType: "application/pdf", filename: "a.pdf", body: { size: 10 } },
      ],
    });
    expect(r).toMatchObject({ body: "일반 텍스트 본문", bodySource: "plain", truncated: false, subject: "제목", to: "me@example.com", date: "2026-10-10T09:00:00+09:00" });
  });

  it("converts an HTML-only mail to text without scripts and styles", async () => {
    const r = await read(html("<html><head><style>p{color:red}</style></head><body><script>alert(1)</script><p>첫째 줄</p><p>둘째&nbsp;줄 &amp; 끝</p></body></html>"));
    expect(r.bodySource).toBe("html");
    expect(r.body).toBe("첫째 줄\n둘째 줄 & 끝");
    expect(r.body).not.toMatch(/alert|color/);
  });

  it("cuts a long body at the limit and says so, with the original length", async () => {
    const r = await read(plain("가".repeat(BODY_LIMIT + 1234)));
    expect(r.truncated).toBe(true);
    expect(Array.from(r.body)).toHaveLength(BODY_LIMIT);
    expect(r.originalLength).toBe(BODY_LIMIT + 1234);
  });

  it("a body exactly at the limit is not marked truncated", async () => {
    const r = await read(plain("나".repeat(BODY_LIMIT)));
    expect(r).toMatchObject({ truncated: false, originalLength: BODY_LIMIT });
  });

  it("reads an EUC-KR plain text part using its declared charset", async () => {
    const euckr = Buffer.from([0xc7, 0xd1, 0xb1, 0xdb]); // "한글" in EUC-KR
    const r = await read(plain("", { headers: [{ name: "Content-Type", value: 'text/plain; charset="euc-kr"' }], body: { data: b64(euckr) } }));
    expect(r.body).toBe("한글");
  });

  it("ignores an attachment that happens to be text/plain", async () => {
    const r = await read({ mimeType: "multipart/mixed", parts: [plain("본문"), plain("첨부 내용", { filename: "note.txt" })] });
    expect(r.body).toBe("본문");
  });

  it("an empty mail has an empty body and says where it came from", async () => {
    expect(await read({ mimeType: "multipart/mixed", parts: [] })).toMatchObject({ body: "", bodySource: "none", truncated: false, originalLength: 0 });
  });

  it("carries the untrusted-content notice", async () => {
    expect((await read(plain("x"))).notice).toBe(UNTRUSTED_NOTICE);
  });
});

describe("mime helpers", () => {
  it("decodes Q-encoded and adjacent encoded words", () => {
    expect(decodeEncodedWords("=?UTF-8?Q?caf=C3=A9_menu?=")).toBe("café menu");
    const a = `=?UTF-8?B?${Buffer.from("가나").toString("base64")}?=`;
    const b = `=?UTF-8?B?${Buffer.from("다라").toString("base64")}?=`;
    expect(decodeEncodedWords(`${a}\r\n ${b}`)).toBe("가나다라");
  });
  it("leaves an already-decoded value alone", () => {
    expect(decodeEncodedWords("그냥 제목")).toBe("그냥 제목");
  });
  it("htmlToText handles entities and numeric references", () => {
    expect(htmlToText("<div>a&lt;b&#33;&#x3f;</div>")).toBe("a<b!?");
  });
  it("truncateText does not split a two-unit character", () => {
    const r = truncateText("😀😀😀", 2);
    expect(r).toEqual({ text: "😀😀", truncated: true, originalLength: 3 });
  });
  it("extractBody on nothing is empty", () => {
    expect(extractBody(undefined)).toEqual({ text: "", source: "none" });
  });
});

describe("GmailClient errors and retries", () => {
  const status = (s: number, body: object = {}, headers: Record<string, string> = {}) => json(body, s, headers);

  it("maps statuses to distinct codes", () => {
    expect(mapGoogleError(401, {}).code).toBe("auth_expired");
    expect(mapGoogleError(403, { error: { errors: [{ reason: "insufficientPermissions" }] } }).code).toBe("permission_denied");
    expect(mapGoogleError(403, { error: { errors: [{ reason: "userRateLimitExceeded" }] } }).code).toBe("rate_limited");
    expect(mapGoogleError(403, { error: { errors: [{ reason: "accessNotConfigured" }] } }).code).toBe("config_error");
    expect(mapGoogleError(404, {}).code).toBe("not_found");
    expect(mapGoogleError(400, {}).code).toBe("validation_error");
    expect(mapGoogleError(503, {}).code).toBe("unavailable");
  });

  it("retries a 429, honouring Retry-After, then succeeds", async () => {
    let n = 0;
    const waits: number[] = [];
    const lines: string[] = [];
    const logger = createLogger("debug", (l) => lines.push(l));
    const fetchFn = (async () => (++n === 1 ? status(429, {}, { "retry-after": "3" }) : json({ ok: true }))) as FetchFn;
    const client = new GmailClient({ getAccessToken: async () => "t" }, logger, { fetchFn, sleep: async (ms) => void waits.push(ms) });
    expect(await client.getJson("/messages")).toEqual({ ok: true });
    expect(waits).toEqual([3000]);
  });

  it("gives up on a persistent 429 with a rate_limited error that says how long to wait", async () => {
    const { client } = fakeGmail(() => status(429, {}, { "retry-after": "30" }));
    await expect(client.getJson("/messages")).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 30 });
  });

  it("retries 503 then reports unavailable; a network failure is unavailable too", async () => {
    const down = fakeGmail(() => status(503));
    await expect(down.client.getJson("/messages")).rejects.toMatchObject({ code: "unavailable" });
    expect(down.requests).toHaveLength(3);
    const offline = fakeGmail(() => new Error("ECONNRESET secret-host"));
    const err = await offline.client.getJson("/messages").catch((e: AppError) => e);
    expect(err).toMatchObject({ code: "unavailable" });
    expect(JSON.stringify(err)).not.toContain("secret-host");
  });

  it("does not retry a 404 and never echoes Google's error text", async () => {
    const { client, requests } = fakeGmail(() => status(404, { error: { message: "제목: 비밀 메일 not found" } }));
    const err = await client.getJson("/messages/x").catch((e: AppError) => e);
    expect(err).toMatchObject({ code: "not_found" });
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(err)).not.toContain("비밀 메일");
  });

  it("sends the bearer token and repeats metadataHeaders", async () => {
    let auth = "";
    const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
      auth = String((init?.headers as Record<string, string>).Authorization);
      expect(new URL(String(u)).searchParams.getAll("metadataHeaders")).toEqual(["Subject", "From"]);
      return json({});
    }) as FetchFn;
    const client = new GmailClient({ getAccessToken: async () => "tok-123" }, createLogger("silent"), { fetchFn });
    await client.getJson("/messages/1", { metadataHeaders: ["Subject", "From"] });
    expect(auth).toBe("Bearer tok-123");
  });
});
