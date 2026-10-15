// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import type { Sources } from "../src/briefing/sources";
import { applyWrites, findListId, planWrites } from "../src/briefing/writes";
import { AppError } from "../src/errors";
import type { ToolCaller } from "../src/mcp/pool";
import type { AcceptedCandidate } from "../src/model/interpret";

const SOURCES: Sources = {
  mails: [
    { id: "m1", threadId: "t1", subject: "학회 안내", from: "a", date: "d", snippet: "" },
    { id: "m2", threadId: "t1", subject: "[추가 사항] 학회 안내", from: "a", date: "d", snippet: "" },
    { id: "m3", threadId: "t3", subject: "면담", from: "b", date: "d", snippet: "" },
  ],
  github: [{ kind: "assigned", repo: "o/r", id: "o/r#9", title: "데이터 정리", url: "https://github.com/o/r/issues/9", updatedAt: "x", dueDate: "2026-10-16" }],
  papers: [],
};
const c = (title: string, due: string | null, sourceId: string, extra: Partial<AcceptedCandidate> = {}): AcceptedCandidate => ({ title, due, source: sourceId.includes("#") ? "github" : "mail", sourceId, evidence: "e", ...extra });

describe("planWrites", () => {
  it("does not create what is already in To Do with the same name and deadline (case and spaces ignored)", () => {
    const plan = planWrites([c("랩미팅", "2026-10-12", "m3"), c(" Lab  Meeting ", null, "m3"), c("새 일", "2026-10-20", "m3")], SOURCES, [{ name: "랩미팅", deadline: "2026-10-12" }, { name: "lab meeting", deadline: "" }]);
    expect(plan.toCreate.map((t) => t.title)).toEqual(["새 일"]);
    expect(plan.alreadyInTodo).toEqual(["랩미팅", " Lab  Meeting "]);
  });

  it("the same name with a different deadline is a different task", () => {
    expect(planWrites([c("랩미팅", "2026-10-19", "m3")], SOURCES, [{ name: "랩미팅", deadline: "2026-10-12" }]).toCreate).toHaveLength(1);
  });

  it("a duplicate within the same run is created once", () => {
    expect(planWrites([c("새 일", "2026-10-20", "m3"), c("새 일", "2026-10-20", "m1")], SOURCES, []).toCreate).toHaveLength(1);
  });

  it("undated items from the same mail thread are merged into one task", () => {
    const plan = planWrites([c("발표 자료 보내기", null, "m1"), c("등록비 납부", null, "m2"), c("숙소 예약", null, "m1")], SOURCES, []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0]!.title).toBe("발표 자료 보내기");
    expect(plan.toCreate[0]!.body).toBe("메일: 학회 안내\n마감 없음: 날짜가 적혀 있지 않았어요.\n함께 할 일: 등록비 납부\n함께 할 일: 숙소 예약");
    expect(plan.toCreate[0]!.sourceIds).toEqual(["m1", "m2"]);
  });

  it("dated items of one thread stay separate (they have their own deadlines)", () => {
    expect(planWrites([c("초록", "2026-10-30", "m1"), c("등록", "2026-11-05", "m2")], SOURCES, []).toCreate).toHaveLength(2);
  });

  it("over the cap, only the first ones are planned and the rest are listed", () => {
    const plan = planWrites([1, 2, 3, 4].map((i) => c(`일 ${i}`, `2026-10-2${i}`, "m3")), SOURCES, [], 3);
    expect(plan.toCreate.map((t) => t.title)).toEqual(["일 1", "일 2", "일 3"]);
    expect(plan.overLimit).toEqual(["일 4"]);
  });

  it("the body is a human-readable source: the mail subject or the GitHub address, never a machine marker", () => {
    const plan = planWrites([c("메일 일", "2026-10-30", "m3"), c("이슈 일", "2026-10-16", "o/r#9")], SOURCES, []);
    expect(plan.toCreate.map((t) => t.body)).toEqual(["메일: 면담", "GitHub: https://github.com/o/r/issues/9"]);
    for (const t of plan.toCreate) expect(t.body).not.toMatch(/\[비서|m3|#0/);
  });

  it("a date that the model gave without support is shown as needing a check", () => {
    const plan = planWrites([c("면담", null, "m3", { dueDropped: true })], SOURCES, []);
    expect(plan.toCreate[0]).toMatchObject({ needsDateCheck: true, due: null });
    expect(plan.toCreate[0]!.body).toContain("마감 확인 필요");
  });
});

function caller(over: { lists?: unknown; create?: (args: Record<string, unknown>) => unknown } = {}) {
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const c: ToolCaller = {
    async call(_s, tool, args = {}) {
      calls.push({ tool, args });
      if (tool === "list_task_lists") return over.lists ?? { items: [{ id: "A", displayName: "개인" }, { id: "B", displayName: "작업", wellknownListName: "defaultList" }] };
      const out = over.create ? over.create(args) : { id: "n", title: args.title };
      if (out instanceof Error) throw out;
      return out;
    },
    async tools() { return []; },
    async close() {},
  };
  return { caller: c, calls };
}

describe("findListId and applyWrites", () => {
  it("uses the named list when given, the default list otherwise", async () => {
    expect(await findListId(caller().caller, "개인")).toBe("A");
    expect(await findListId(caller().caller)).toBe("B");
    expect(await findListId(caller().caller, "없는 목록")).toBe("B");
    await expect(findListId(caller({ lists: { items: [] } }).caller)).rejects.toMatchObject({ code: "config_error" });
  });

  it("creates each planned task, counts the ones the server says already existed, and keeps going after a failure", async () => {
    const { caller: cl, calls } = caller({ create: (a) => (a.title === "실패" ? new AppError("tool_error", "x", { toolCode: "rate_limited" }) : a.title === "있음" ? { id: "o", title: "있음", alreadyExisted: true } : { id: "n", title: a.title }) });
    const plan = planWrites([c("실패", "2026-10-21", "m3"), c("있음", "2026-10-22", "m3"), c("새것", null, "o/r#9")], SOURCES, []);
    const r = await applyWrites(cl, plan, "B");
    expect(r).toEqual({ created: [{ title: "새것", due: null, sourceIds: ["o/r#9"] }], existed: ["있음"], failed: [{ title: "실패", code: "rate_limited" }] });
    expect(calls.filter((x) => x.tool === "create_task").map((x) => x.args)).toEqual([
      { listId: "B", title: "실패", body: "메일: 면담", dueDateTime: "2026-10-21" },
      { listId: "B", title: "있음", body: "메일: 면담", dueDateTime: "2026-10-22" },
      { listId: "B", title: "새것", body: "GitHub: https://github.com/o/r/issues/9\n마감 없음: 날짜가 적혀 있지 않았어요." },
    ]);
  });
});
