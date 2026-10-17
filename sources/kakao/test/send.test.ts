// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { checkMessage, countChars, KakaoApi, MAX_BATCH, TEXT_LIMIT, type KakaoApiOptions } from "../src/kakao/api";
import { createLogger } from "@morning-desk/shared";
import type { FetchFn } from "../src/auth/provider";

interface Sent { url: string; text: string; link: string; auth: string }

/** 카카오 메모 API와 인증을 흉내 낸다. 호출 순서대로 준비한 응답을 돌려주고, 보낸 내용을 기록한다. */
function setup(responses: (Response | Error)[] = [], over: Partial<KakaoApiOptions> = {}) {
  const sent: Sent[] = [];
  const tokenCalls: boolean[] = [];
  let i = 0;
  const fetchFn: FetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const form = new URLSearchParams(String(init?.body ?? ""));
    const tpl = JSON.parse(form.get("template_object") ?? "{}") as { text: string; link: { web_url: string } };
    sent.push({ url: String(url), text: tpl.text, link: tpl.link?.web_url, auth: String((init?.headers as Record<string, string>).Authorization) });
    const r = responses[i++] ?? ok();
    if (r instanceof Error) throw r;
    return r;
  }) as FetchFn;
  const auth = { getAccessToken: async (o: { force?: boolean } = {}) => { tokenCalls.push(Boolean(o.force)); return o.force ? "tok-fresh" : "tok-1"; } };
  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const api = new KakaoApi(auth, logger, { linkUrl: "https://example.com/tasks", dryRunAll: false, fetchFn, ...over });
  return { api, sent, tokenCalls, lines };
}
const ok = () => new Response(JSON.stringify({ result_code: 0 }), { status: 200 });
const status = (s: number, headers: Record<string, string> = {}) => new Response(JSON.stringify({ msg: "x", code: -1 }), { status: s, headers });

describe("character limit", () => {
  it("200 characters is allowed; 201 is rejected and never sent", async () => {
    const a = setup();
    await a.api.sendOne("가".repeat(TEXT_LIMIT));
    expect(a.sent).toHaveLength(1);
    const b = setup();
    await expect(b.api.sendOne("가".repeat(TEXT_LIMIT + 1))).rejects.toMatchObject({ code: "validation_error" });
    expect(b.sent).toHaveLength(0);
  });

  it("a 230-character message is rejected with 'over by 30' and nothing is sent", async () => {
    const { api, sent } = setup();
    const err = await api.sendOne("나".repeat(230)).catch((e: AppError) => e);
    expect(err).toMatchObject({ code: "validation_error" });
    expect((err as AppError).message).toMatch(/230 characters, 30 over the 200-character limit/);
    expect(sent).toHaveLength(0);
  });

  it("counts characters, not UTF-16 units: an emoji is one character", () => {
    expect(countChars("😀".repeat(200))).toBe(200);
    expect(() => checkMessage("😀".repeat(200), 0, 1)).not.toThrow();
    expect(() => checkMessage("😀".repeat(201), 0, 1)).toThrow(/1 over/);
  });

  it("rejects an empty or blank message", async () => {
    const { api, sent } = setup();
    await expect(api.sendOne("")).rejects.toMatchObject({ code: "validation_error" });
    await expect(api.sendOne("   \n ")).rejects.toMatchObject({ code: "validation_error" });
    expect(sent).toHaveLength(0);
  });

  it("the error message never contains the message text", async () => {
    const { api } = setup();
    const err = await api.sendOne("극비 내용 ".repeat(60)).catch((e: AppError) => e);
    expect(JSON.stringify(err)).not.toContain("극비");
  });
});

describe("sending to yourself", () => {
  it("posts a text template with the configured link to the memo endpoint using the bearer token", async () => {
    const { api, sent } = setup();
    const r = await api.sendOne("안녕하세요");
    expect(sent).toEqual([{ url: "https://kapi.kakao.com/v2/api/talk/memo/default/send", text: "안녕하세요", link: "https://example.com/tasks", auth: "Bearer tok-1" }]);
    expect(r).toEqual({ dryRun: false, sent: 1, messages: [{ index: 1, chars: 5 }] });
  });

  it("does not echo the message text in a real send response", async () => {
    const { api } = setup();
    expect(JSON.stringify(await api.sendOne("비밀 문장"))).not.toContain("비밀");
  });

  it("without KAKAO_LINK_URL a real send is a config error and nothing is posted", async () => {
    const { api, sent } = setup([], { linkUrl: undefined });
    await expect(api.sendOne("x")).rejects.toMatchObject({ code: "config_error" });
    expect(sent).toHaveLength(0);
  });
});

describe("auth errors", () => {
  it("a 401 refreshes once and resends with the new token", async () => {
    const { api, sent, tokenCalls } = setup([status(401), ok()]);
    await api.sendOne("hi");
    expect(sent.map((s) => s.auth)).toEqual(["Bearer tok-1", "Bearer tok-fresh"]);
    expect(tokenCalls).toEqual([false, true]);
  });

  it("a second 401 gives up with auth_expired instead of looping", async () => {
    const { api, sent } = setup([status(401), status(401), ok()]);
    await expect(api.sendOne("hi")).rejects.toMatchObject({ code: "auth_expired" });
    expect(sent).toHaveLength(2);
  });
});

describe("other failures are told apart and never retried", () => {
  const cases: [number, string][] = [[400, "validation_error"], [403, "permission_denied"], [429, "rate_limited"], [500, "unavailable"], [503, "unavailable"], [418, "upstream_error"]];
  for (const [code, expected] of cases) {
    it(`HTTP ${code} -> ${expected}, sent exactly once`, async () => {
      const { api, sent } = setup([status(code), ok()]);
      await expect(api.sendOne("hi")).rejects.toMatchObject({ code: expected });
      expect(sent).toHaveLength(1); // 재전송하면 중복 메시지가 될 수 있다
    });
  }

  it("429 carries the Retry-After wait", async () => {
    const { api } = setup([status(429, { "retry-after": "42" })]);
    await expect(api.sendOne("hi")).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 42 });
  });

  it("a network failure says the message was not confirmed as sent", async () => {
    const { api } = setup([new Error("ECONNRESET")]);
    await expect(api.sendOne("hi")).rejects.toMatchObject({ code: "unavailable", message: expect.stringMatching(/not confirmed as sent/) });
  });

  it("a 200 whose result_code is not 0 is not treated as sent", async () => {
    const { api } = setup([new Response(JSON.stringify({ result_code: -1 }), { status: 200 })]);
    await expect(api.sendOne("hi")).rejects.toMatchObject({ code: "upstream_error" });
  });
});

describe("several messages", () => {
  it("sends the maximum number in the given order", async () => {
    const { api, sent } = setup();
    const texts = Array.from({ length: MAX_BATCH }, (_, i) => `m${i + 1}`);
    const r = await api.sendMany(texts);
    expect(sent.map((s) => s.text)).toEqual(texts);
    expect(r).toMatchObject({ sent: MAX_BATCH, dryRun: false });
  });

  it("one more than the maximum: none is sent, input error", async () => {
    const { api, sent } = setup();
    await expect(api.sendMany(Array.from({ length: MAX_BATCH + 1 }, (_, i) => `m${i}`))).rejects.toMatchObject({ code: "validation_error", message: expect.stringContaining(`at most ${MAX_BATCH}`) });
    expect(sent).toHaveLength(0);
  });

  it("one invalid message means none is sent, even if it comes last", async () => {
    const { api, sent } = setup();
    await expect(api.sendMany(["fine", "fine too", "x".repeat(201)])).rejects.toMatchObject({ code: "validation_error", message: expect.stringContaining("Message 3 of 3") });
    expect(sent).toHaveLength(0);
  });

  it("when the second fails, it stops and says how many went out", async () => {
    const { api, sent } = setup([ok(), status(500), ok()]);
    const err = await api.sendMany(["a", "b", "c"]).catch((e: AppError) => e);
    expect(err).toMatchObject({ code: "unavailable" });
    expect((err as AppError).message).toMatch(/Message 2 of 3 was not sent; 1 before it were sent/);
    expect(sent).toHaveLength(2);
  });

  it("an empty list is an input error", async () => {
    await expect(setup().api.sendMany([])).rejects.toMatchObject({ code: "validation_error" });
  });
});

describe("dry run", () => {
  it("sends nothing to Kakao and returns the text and character counts", async () => {
    const { api, sent, tokenCalls } = setup();
    const r = await api.sendMany(["가나다", "abc"], { dryRun: true });
    expect(sent).toHaveLength(0);
    expect(tokenCalls).toHaveLength(0);
    expect(r).toEqual({ dryRun: true, sent: 0, messages: [{ index: 1, chars: 3, text: "가나다" }, { index: 2, chars: 3, text: "abc" }] });
  });

  it("applies the same limits as a real send", async () => {
    const { api } = setup();
    await expect(api.sendOne("나".repeat(230), { dryRun: true })).rejects.toMatchObject({ code: "validation_error", message: expect.stringMatching(/30 over/) });
    await expect(api.sendMany(Array.from({ length: MAX_BATCH + 1 }, (_, i) => `m${i}`), { dryRun: true })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("works without a link configured", async () => {
    const { api } = setup([], { linkUrl: undefined });
    expect(await api.sendOne("hi", { dryRun: true })).toMatchObject({ dryRun: true });
  });

  it("KAKAO_DRY_RUN forces dry run even when the caller asks for a real send", async () => {
    const { api, sent } = setup([], { dryRunAll: true });
    const r = await api.sendOne("hi", { dryRun: false });
    expect(sent).toHaveLength(0);
    expect(r).toMatchObject({ dryRun: true, forcedDryRun: true, sent: 0 });
  });
});
