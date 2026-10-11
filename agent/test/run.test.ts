// my-task original code (not derived from upstream).
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deliver } from "../src/briefing/deliver";
import { AppError } from "../src/errors";
import { createLogger } from "../src/logger";
import type { ToolCaller } from "../src/mcp/pool";
import { MemoryStore } from "../src/memory";
import type { ChatMessage, Model } from "../src/model/client";
import { ALLOWED_CALLS, guard, WRITE_CALLS } from "../src/policy";
import { run, type RunOptions } from "../src/run";

const NOW = new Date("2026-10-11T22:00:00Z"); // 한국 시간 10/12 07:00 월요일
const quiet = createLogger("silent");

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "agent-run-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

interface Call { server: string; tool: string; args: Record<string, unknown> }
type Answer = unknown | Error;

const MAIL = { id: "m1", threadId: "t1", subject: "학회 초록 제출 안내", from: "conf@x.org", date: "2026-10-12T06:00:00+09:00", snippet: "초록 마감", threadSubject: "학회 초록 제출 안내" };

/** 다섯 서버를 흉내 낸다. 모든 호출을 기록한다. */
function world(over: Partial<Record<"todo" | "kakao" | "gmail" | "github" | "folio" | "create", Answer>> = {}) {
  const calls: Call[] = [];
  const pick = (v: Answer | undefined, fallback: unknown) => { if (v instanceof Error) throw v; return v ?? fallback; };
  const caller: ToolCaller = {
    async call(server, tool, args = {}) {
      calls.push({ server, tool, args });
      if (server === "todo" && tool === "list_tasks_due") return pick(over.todo, { items: [{ title: "랩미팅", dueDate: "2026-10-12", body: { content: "15:00" } }] });
      if (server === "todo" && tool === "list_task_lists") return { items: [{ id: "L1", displayName: "작업", wellknownListName: "defaultList" }] };
      if (server === "todo" && tool === "create_task") return pick(over.create, { id: `new-${String(args.title)}`, title: args.title, alreadyExisted: false });
      if (server === "gmail") return pick(over.gmail, tool === "search_emails" ? { items: [MAIL] } : { body: "초록 제출 기한은 2026년 10월 30일까지입니다." });
      if (server === "github") return pick(over.github, { items: [] });
      if (server === "folio") return pick(over.folio, { items: [] });
      if (server === "kakao") {
        if (over.kakao !== undefined) return pick(over.kakao, null);
        const msgs = args.messages as string[];
        const dry = Boolean(args.dryRun);
        return { dryRun: dry, sent: dry ? 0 : msgs.length, messages: msgs.map((m, i) => ({ index: i + 1, chars: Array.from(m).length })) };
      }
      throw new Error(`unexpected ${server}.${tool}`);
    },
    async tools() { return []; },
    async close() {},
  };
  return { caller, calls };
}

const GOOD = {
  candidates: [{ title: "학회 초록 제출", due: "2026-10-30", dueEvidence: "초록 제출 기한은 2026년 10월 30일까지입니다", source: "mail", sourceId: "m1", evidence: "초록 제출 기한은 2026년 10월 30일까지입니다" }],
  remark: [{ text: "오늘은 랩미팅이 있어요.", evidence: "랩미팅 (마감 2026-10-12)" }, { text: "학회 초록 준비는 시작하셨나요?", evidence: "학회 초록 제출 안내" }],
};
function model(answer: unknown | Error = GOOD) {
  const calls: ChatMessage[][] = [];
  const m: Model = { async complete(messages) { calls.push(messages); if (answer instanceof Error) throw answer; return typeof answer === "string" ? answer : JSON.stringify(answer); } };
  return { model: m, calls };
}

const go = (w: ReturnType<typeof world>, opts: Partial<RunOptions> = {}, m: Model | null = model().model, memory: MemoryStore | null = new MemoryStore(join(dir, "memory.json"))) =>
  run({ caller: w.caller, model: m, memory, logger: quiet }, { dryRun: false, now: NOW, ...opts });

describe("a normal day", () => {
  it("reads sources and To Do, asks the model, and sends the briefing with the new item and the remark", async () => {
    const w = world();
    const r = await go(w, { createTasks: true });
    const text = r.messages.join("\n");
    expect(r.status).toBe("sent");
    expect(text).toContain("[오늘]\n· 랩미팅 15:00");
    expect(text).toContain("[새로 찾은 일]\n· 학회 초록 제출(10/30)");
    expect(text).toContain("오늘은 랩미팅이 있어요.");
    expect(w.calls.at(-1)).toMatchObject({ server: "kakao", tool: "send_many_to_me" });
  });

  it("adds the task through To Do's create_task with a human-readable source and no internal markers", async () => {
    const w = world();
    await go(w, { createTasks: true });
    const create = w.calls.find((c) => c.tool === "create_task")!;
    expect(create.args).toEqual({ listId: "L1", title: "학회 초록 제출", body: "메일: 학회 초록 제출 안내", dueDateTime: "2026-10-30" });
    expect(String(create.args.body)).not.toMatch(/\[비서|#\d|id=|m1/);
  });

  it("with task creation off (the default comparison phase) nothing is added, and the briefing says so", async () => {
    const w = world();
    const r = await go(w);
    expect(w.calls.some((c) => c.tool === "create_task")).toBe(false);
    expect(r.messages.join("\n")).toContain("비교 모드라 To Do에 추가하지 않았어요.");
    expect(r.messages.join("\n")).toContain("학회 초록 제출(10/30)");
  });
});

describe("dry run", () => {
  it("reads and asks the model, but sends, adds and records nothing", async () => {
    const w = world();
    const m = model();
    const store = new MemoryStore(join(dir, "memory.json"));
    const r = await go(w, { dryRun: true, createTasks: true }, m.model, store);
    expect(r.status).toBe("dry-run");
    expect(m.calls).toHaveLength(1);
    expect(w.calls.some((c) => c.tool === "create_task")).toBe(false);
    const writes = w.calls.filter((c) => WRITE_CALLS.includes(`${c.server}.${c.tool}`));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.args.dryRun).toBe(true);
    expect(store.load().lastSentDate).toBeUndefined();
    expect(r.plan?.toCreate.map((t) => t.title)).toEqual(["학회 초록 제출"]);
  });
});

describe("failures are visible and do not stop the briefing", () => {
  it("a failing source goes to the failure section while the rest is still sent", async () => {
    const w = world({ gmail: new AppError("tool_error", "x", { toolCode: "auth_expired" }) });
    const r = await go(w);
    const text = r.messages.join("\n");
    expect(text).toContain("[⚠ 실패]\n· Gmail 로그인 만료");
    expect(text).toContain("[오늘]\n· 랩미팅 15:00");
    expect(r.status).toBe("sent");
  });

  it("the model cannot be reached: the model-free briefing is sent with the cause on top", async () => {
    const w = world();
    const r = await go(w, {}, model(new AppError("timeout", "slow")).model);
    const text = r.messages.join("\n");
    expect(text).toContain("[⚠ 실패]\n· 모델 시간 초과");
    expect(text).toContain("모델 없이 만든 기본 브리핑이에요.");
    expect(text).toContain("[오늘]\n· 랩미팅 15:00");
    expect(w.calls.at(-1)).toMatchObject({ tool: "send_many_to_me" });
  });

  it("no model configured: still a briefing, marked as made without the model", async () => {
    const r = await go(world(), {}, null);
    expect(r.messages.join("\n")).toContain("· 모델 설정 누락");
  });

  it("To Do cannot be read: a failure notice alone is sent", async () => {
    const w = world({ todo: new AppError("tool_error", "x", { toolCode: "auth_expired" }) });
    const m = model();
    const r = await go(w, {}, m.model);
    expect(r.messages.join("\n")).toContain("· To Do 로그인 만료");
    expect(m.calls).toHaveLength(0);
    expect(w.calls.at(-1)).toMatchObject({ tool: "send_many_to_me" });
  });

  it("when Kakao fails the failure is not swallowed and nothing is recorded as sent", async () => {
    const store = new MemoryStore(join(dir, "memory.json"));
    await expect(go(world({ kakao: new AppError("tool_error", "x", { toolCode: "auth_expired" }) }), {}, model().model, store)).rejects.toMatchObject({ toolCode: "auth_expired" });
    expect(store.load().lastSentDate).toBeUndefined();
  });

  it("a failed task creation is reported and the others still go in", async () => {
    const two = { ...GOOD, candidates: [GOOD.candidates[0]!, { ...GOOD.candidates[0]!, title: "다른 일", due: null, dueEvidence: null, evidence: "학회 초록 제출 안내" }] };
    let n = 0;
    const w = world();
    const failing = { ...w.caller, async call(server: never, tool: string, args?: Record<string, unknown>) { if (tool === "create_task" && n++ === 0) throw new AppError("tool_error", "x", { toolCode: "rate_limited" }); return w.caller.call(server, tool, args); } } as ToolCaller;
    const r = await run({ caller: failing, model: model(two).model, memory: null, logger: quiet }, { dryRun: false, now: NOW, createTasks: true });
    expect(r.writes?.failed).toEqual([{ title: "학회 초록 제출", code: "rate_limited" }]);
    expect(r.writes?.created.map((c) => c.title)).toEqual(["다른 일"]);
    expect(r.messages.join("\n")).toContain("· To Do 추가 실패 1건");
  });
});

describe("memory and same-day runs", () => {
  it("records what was processed, what was added and the question asked, with owner-only permissions", async () => {
    const store = new MemoryStore(join(dir, "sub", "memory.json"));
    await go(world(), { createTasks: true }, model().model, store);
    const m = store.load();
    expect(m.lastSentDate).toBe("2026-10-12");
    expect(m.processed.mail).toEqual({ m1: "2026-10-12" });
    expect(m.days["2026-10-12"]).toEqual({ top: ["랩미팅"], created: ["학회 초록 제출"], questions: ["학회 초록 준비는 시작하셨나요?"] });
    expect(statSync(join(dir, "sub", "memory.json")).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "sub")).mode & 0o777).toBe(0o700);
  });

  it("a second real run on the same day does not send again unless forced", async () => {
    const store = new MemoryStore(join(dir, "memory.json"));
    await go(world(), {}, model().model, store);
    const w2 = world();
    const again = await go(w2, {}, model().model, store);
    expect(again.status).toBe("already-sent");
    expect(w2.calls).toHaveLength(0);
    const w3 = world();
    expect((await go(w3, { force: true }, model().model, store)).status).toBe("sent");
    expect(w3.calls.at(-1)).toMatchObject({ tool: "send_many_to_me" });
  });

  it("a processed mail is not read or interpreted again the next day", async () => {
    const store = new MemoryStore(join(dir, "memory.json"));
    await go(world(), {}, model().model, store);
    const w2 = world();
    const m2 = model({ candidates: [], remark: [] });
    await run({ caller: w2.caller, model: m2.model, memory: store, logger: quiet }, { dryRun: false, now: new Date("2026-10-12T22:00:00Z") });
    expect(w2.calls.some((c) => c.tool === "read_email")).toBe(false);
    expect(m2.calls[0]!.at(-1)!.content).not.toContain("[메일 id=m1]");
  });

  it("over the per-run cap, the extra candidates are not added and the briefing says how many", async () => {
    const many = { candidates: [1, 2, 3].map((i) => ({ title: `일 ${i}`, due: null, dueEvidence: null, source: "mail", sourceId: "m1", evidence: "학회 초록 제출 안내" })), remark: [] };
    // 같은 스레드의 마감 없는 일은 합쳐지므로, 상한을 보려면 서로 다른 날짜를 준다
    const dated = { ...many, candidates: many.candidates.map((c, i) => ({ ...c, due: "2026-10-30", dueEvidence: "2026년 10월 30일", title: `일 ${i + 1}` })) };
    const w = world();
    const r = await go(w, { createTasks: true, maxCreates: 2 }, model(dated).model);
    expect(w.calls.filter((c) => c.tool === "create_task")).toHaveLength(2);
    expect(r.messages.join("\n")).toContain("한 번에 2건까지만 추가해요. 1건은 추가하지 않았어요.");
  });

  it("when the model failed, the sources are not marked processed (they will be looked at again)", async () => {
    const store = new MemoryStore(join(dir, "memory.json"));
    await go(world(), {}, model(new AppError("timeout", "x")).model, store);
    expect(store.load().processed.mail).toEqual({});
    expect(store.load().lastSentDate).toBe("2026-10-12");
  });

  it("the next day the model is given yesterday's record so it does not repeat the question", async () => {
    const store = new MemoryStore(join(dir, "memory.json"));
    await go(world(), {}, model().model, store);
    const m2 = model({ candidates: [], remark: [] });
    await run({ caller: world().caller, model: m2.model, memory: store, logger: quiet }, { dryRun: false, now: new Date("2026-10-12T22:00:00Z") });
    expect(m2.calls[0]!.at(-1)!.content).toContain("던진 질문: 학회 초록 준비는 시작하셨나요?");
  });

  it("a question asked yesterday is not repeated today, even if the model writes it again", async () => {
    const store = new MemoryStore(join(dir, "memory.json"));
    await go(world(), {}, model().model, store);
    const w2 = world();
    const r = await run({ caller: w2.caller, model: model(GOOD).model, memory: store, logger: quiet }, { dryRun: false, now: new Date("2026-10-12T22:00:00Z") });
    const text = r.messages.join("\n");
    expect(text).not.toContain("학회 초록 준비는 시작하셨나요?");
    expect(store.load().days["2026-10-13"]!.questions).toEqual([]);
  });

  it("the first run with no memory works", async () => {
    const r = await go(world(), {}, model().model, new MemoryStore(join(dir, "none", "memory.json")));
    expect(r.status).toBe("sent");
  });
});

describe("deliver and policy", () => {
  it("deliver refuses to send nothing and reports char counts", async () => {
    await expect(deliver(world().caller, [], { dryRun: false })).rejects.toMatchObject({ code: "validation_error" });
    expect(await deliver(world().caller, ["가나다", "abcde"], { dryRun: false })).toEqual({ dryRun: false, sent: 2, chars: [3, 5] });
    await expect(deliver(world({ kakao: { ok: true } }).caller, ["x"], { dryRun: false })).rejects.toMatchObject({ code: "tool_error", toolCode: "contract_changed" });
  });

  it("the policy allows exactly the planned tools; the only writes are adding a task and sending to yourself", () => {
    expect(ALLOWED_CALLS).toEqual({
      todo: ["list_tasks_due", "list_task_lists", "list_tasks", "get_task", "create_task"],
      gmail: ["search_emails", "read_email"],
      github: ["list_review_requests", "list_assigned_items", "list_notifications"],
      folio: ["list_recent_papers", "search_papers"],
      kakao: ["send_many_to_me"],
    });
    expect([...WRITE_CALLS].sort()).toEqual(["kakao.send_many_to_me", "todo.create_task"]);
    const forbidden = /update|complete|delete|remove|edit|patch|merge|comment|trash|archive|move|sign_in|send_to_me$/;
    for (const [server, tools] of Object.entries(ALLOWED_CALLS)) for (const t of tools) expect(t, `${server}.${t}`).not.toMatch(forbidden);
  });

  it("a guarded caller refuses anything outside the list before it reaches a server", async () => {
    const w = world();
    const g = guard(w.caller);
    for (const [server, tool] of [["todo", "update_task"], ["todo", "delete_task"], ["gmail", "send_email"], ["kakao", "send_to_me"], ["github", "create_issue"], ["nope", "x"]] as const) {
      await expect(g.call(server as never, tool), `${server}.${tool}`).rejects.toMatchObject({ code: "config_error" });
    }
    expect(w.calls).toHaveLength(0);
  });
});
