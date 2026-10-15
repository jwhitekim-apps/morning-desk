// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { collectSources } from "../src/briefing/sources";
import { AppError } from "../src/errors";
import type { ToolCaller } from "../src/mcp/pool";

const NOW = new Date("2026-10-11T22:00:00Z"); // 한국 시간 10/12 07:00
const toolErr = (code: string) => new AppError("tool_error", "x", { toolCode: code });

const MAILS = [
  { id: "m1", threadId: "t1", subject: "학회 안내", from: "a@x.com", date: "2026-10-12T06:00:00+09:00", snippet: "초록 마감", threadSubject: "학회 안내" },
  { id: "m2", threadId: "t2", subject: "면담", from: "b@x.com", date: "2026-10-11T20:00:00+09:00", snippet: "금요일" },
  { id: "m3", threadId: "t3", subject: "공지", from: "c@x.com", date: "2026-10-11T10:00:00+09:00", snippet: "점검" },
];

type Handler = (tool: string, args: Record<string, unknown>) => unknown;
function world(handlers: Partial<Record<"gmail" | "github" | "folio", Handler>> = {}) {
  const calls: { server: string; tool: string; args: Record<string, unknown> }[] = [];
  const defaults: Record<string, Handler> = {
    gmail: (tool, args) => (tool === "search_emails" ? { items: MAILS } : { body: `본문 ${String(args.id)}`, truncated: false }),
    github: (tool) =>
      tool === "list_review_requests"
        ? { items: [{ repo: "o/r", number: 7, title: "리뷰 부탁", url: "https://github.com/o/r/pull/7", updatedAt: "2026-10-11T10:00:00+09:00" }] }
        : tool === "list_assigned_items"
          ? { items: [{ repo: "o/r", number: 9, title: "이슈", url: "https://github.com/o/r/issues/9", updatedAt: "2026-10-10T10:00:00+09:00", milestone: { title: "v1", dueDate: "2026-10-16" } }, { repo: "o/r", number: 10, title: "마감 없음", url: "u", updatedAt: "2026-10-09T10:00:00+09:00", milestone: null }] }
          : { items: [{ id: "n1", repo: "o/r", reason: "mention", title: "멘션", url: null, updatedAt: "2026-10-11T09:00:00+09:00" }, { id: "n2", repo: "o/r", reason: "ci_activity", title: "CI", url: null, updatedAt: "2026-10-11T09:00:00+09:00" }] },
    folio: () => ({ items: [{ itemKey: "K1", title: "Paper One", syncedAt: "2026-10-10T10:00:00+09:00" }] }),
  };
  const caller: ToolCaller = {
    async call(server, tool, args = {}) {
      calls.push({ server, tool, args });
      const h = (handlers as Record<string, Handler | undefined>)[server] ?? defaults[server];
      if (!h) throw new Error(`no handler ${server}`);
      const out = h(tool, args);
      if (out instanceof Error) throw out;
      return out;
    },
    async tools() { return []; },
    async close() {},
  };
  return { caller, calls };
}

describe("collectSources", () => {
  it("reads mail, GitHub and papers with fixed tool calls", async () => {
    const { caller, calls } = world();
    const r = await collectSources(caller, NOW, { githubNotifications: true });
    expect(r.failures).toEqual([]);
    expect(r.sources.mails.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(r.sources.github.map((g) => [g.kind, g.id])).toEqual([["review_request", "o/r#7"], ["assigned", "o/r#9"], ["assigned", "o/r#10"], ["notification", "notif:n1"]]);
    expect(r.sources.papers).toEqual([{ itemKey: "K1", title: "Paper One", syncedAt: "2026-10-10T10:00:00+09:00" }]);
    const tools = new Set(calls.map((c) => `${c.server}.${c.tool}`));
    expect([...tools].sort()).toEqual(["folio.list_recent_papers", "github.list_assigned_items", "github.list_notifications", "github.list_review_requests", "gmail.read_email", "gmail.search_emails"]);
  });

  it("searches the last two days of the inbox without promotions, and asks for papers of the last week in Korea dates", async () => {
    const { caller, calls } = world();
    await collectSources(caller, NOW);
    expect(calls.find((c) => c.tool === "search_emails")!.args).toEqual({ query: "in:inbox -category:promotions -category:social", days: 2, maxResults: 30 });
    expect(calls.find((c) => c.tool === "list_recent_papers")!.args).toEqual({ since: "2026-10-05", maxResults: 100 });
  });

  it("reads bodies only up to the limit, newest first, and marks truncated ones", async () => {
    const { caller, calls } = world({ gmail: (tool, args) => (tool === "search_emails" ? { items: MAILS } : { body: `본문 ${String(args.id)}`, truncated: args.id === "m2" }) });
    const r = await collectSources(caller, NOW, { bodyMax: 2 });
    expect(calls.filter((c) => c.tool === "read_email").map((c) => c.args.id)).toEqual(["m1", "m2"]);
    expect(r.sources.mails.map((m) => [m.id, m.body ?? null, m.truncated ?? false])).toEqual([["m1", "본문 m1", false], ["m2", "본문 m2", true], ["m3", null, false]]);
  });

  it("one unreadable mail body does not stop the others", async () => {
    const { caller } = world({ gmail: (tool, args) => (tool === "search_emails" ? { items: MAILS } : args.id === "m1" ? toolErr("not_found") : { body: "ok" }) });
    const r = await collectSources(caller, NOW);
    expect(r.failures).toEqual([]);
    expect(r.sources.mails.map((m) => m.body ?? null)).toEqual([null, "ok", "ok"]);
  });

  it("skips mail and GitHub items that were already processed, without reading their bodies", async () => {
    const { caller, calls } = world();
    const r = await collectSources(caller, NOW, { processed: { mail: new Set(["m1", "m3"]), github: new Set(["o/r#7"]) } });
    expect(r.sources.mails.map((m) => m.id)).toEqual(["m2"]);
    expect(calls.filter((c) => c.tool === "read_email").map((c) => c.args.id)).toEqual(["m2"]);
    expect(r.sources.github.map((g) => g.id)).not.toContain("o/r#7");
  });

  it("carries the milestone due date of assigned items and leaves it null without one", async () => {
    const { caller } = world();
    const g = (await collectSources(caller, NOW)).sources.github.filter((x) => x.kind === "assigned");
    expect(g.map((x) => x.dueDate)).toEqual(["2026-10-16", null]);
  });

  it("leaves notifications alone unless the notification token is set, and drops CI noise when it is", async () => {
    const off = world();
    await collectSources(off.caller, NOW);
    expect(off.calls.some((c) => c.tool === "list_notifications")).toBe(false);
    const on = (await collectSources(world().caller, NOW, { githubNotifications: true })).sources.github.filter((g) => g.kind === "notification");
    expect(on.map((n) => n.title)).toEqual(["멘션"]);
  });

  it("sources can be switched off and are then not called at all", async () => {
    const { caller, calls } = world();
    const r = await collectSources(caller, NOW, { enabled: { gmail: false, github: false } });
    expect(calls.map((c) => c.server)).toEqual(["folio"]);
    expect(r.sources.mails).toEqual([]);
  });
});

describe("a failing source does not stop the others", () => {
  it("Gmail login expired: the rest still comes back and the failure says why", async () => {
    const { caller } = world({ gmail: () => toolErr("auth_expired") });
    const r = await collectSources(caller, NOW);
    expect(r.failures).toEqual(["Gmail 로그인 만료"]);
    expect(r.sources.mails).toEqual([]);
    expect(r.sources.github.length).toBeGreaterThan(0);
    expect(r.sources.papers).toHaveLength(1);
  });

  it("each source reports its own cause, one line per source", async () => {
    const { caller } = world({ gmail: () => new AppError("timeout", "x"), github: () => toolErr("rate_limited"), folio: () => toolErr("auth_failed") });
    const r = await collectSources(caller, NOW);
    expect(r.failures).toEqual(["Gmail 시간 초과", "GitHub 요청 한도 초과", "폴리오 인증 실패"]);
  });

  it("if only one GitHub tool fails the others still contribute and the failure is reported once", async () => {
    const { caller } = world({ github: (tool) => (tool === "list_review_requests" ? toolErr("rate_limited") : tool === "list_assigned_items" ? { items: [] } : { items: [] }) });
    const r = await collectSources(caller, NOW, { githubNotifications: true });
    expect(r.failures).toEqual(["GitHub 요청 한도 초과"]);
  });

  it("an answer in an unexpected shape is reported as a failure, not read as an empty list", async () => {
    const { caller } = world({ folio: () => ({ nope: true }), gmail: () => ({ items: "x" }) });
    const r = await collectSources(caller, NOW);
    expect(r.failures).toEqual(["Gmail 오류", "폴리오 오류"]);
  });

  it("the failure text never contains the server's own words", async () => {
    const { caller } = world({ gmail: () => new AppError("tool_error", "gmail.search failed (auth_expired): 극비 제목", { toolCode: "auth_expired" }) });
    expect((await collectSources(caller, NOW)).failures.join("")).not.toContain("극비");
  });
});
