// my-task original code (not derived from upstream).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isRealDate, UNTRUSTED_NOTICE } from "../src/veloo/api";
import { json, makeDir, setup, task, type Req } from "./helpers";

let d: ReturnType<typeof makeDir>;
beforeEach(() => { d = makeDir(); });
afterEach(() => { d.cleanup(); });

const list = (rows: unknown) => (r: Req) => (r.path === "/todo/api/todos" ? json(rows) : undefined);
const names = (items: { name: string }[]) => items.map((t) => t.name);

const ROWS = [
  task(1, { name: "미완료 날짜", deadline: "2026-10-13" }),
  task(2, { name: "끝난 일", deadline: "2026-10-13", done: true }),
  task(3, { name: "자유 문구", deadline: "이번 주 안에" }),
  task(4, { name: "마감 없음", deadline: "" }),
  task(5, { name: "범위 밖", deadline: "2026-11-30" }),
  task(6, { name: "경계 시작", deadline: "2026-10-10" }),
  task(7, { name: "경계 끝", deadline: "2026-10-20" }),
];

describe("veloo_list_tasks", () => {
  it("returns open tasks by default, with every documented field", async () => {
    const r = await setup(list([task(1, { name: "논문 읽기", memo: "3장까지", priority: "urgent", deadline: "2026-10-13" })]), { sessionPath: d.path }).api.listTasks();
    expect(r.items).toEqual([{ id: 1, name: "논문 읽기", memo: "3장까지", priority: "urgent", deadline: "2026-10-13", dueDate: "2026-10-13", done: false, createdAt: "2026-10-01T09:30:00+09:00" }]);
    expect(r.notice).toBe(UNTRUSTED_NOTICE);
    expect(r).toMatchObject({ truncated: false, omitted: 0 });
  });

  it("open only leaves out completed tasks; done and all work too", async () => {
    const s = () => setup(list(ROWS), { sessionPath: d.path });
    expect(names((await s().api.listTasks({ status: "open" })).items)).not.toContain("끝난 일");
    expect(names((await s().api.listTasks({ status: "done" })).items)).toEqual(["끝난 일"]);
    expect((await s().api.listTasks({ status: "all" })).items).toHaveLength(ROWS.length);
  });

  it("a date range keeps only real dates inside it (both ends included) and drops free text and empty deadlines", async () => {
    const r = await setup(list(ROWS), { sessionPath: d.path }).api.listTasks({ dueFrom: "2026-10-10", dueTo: "2026-10-20" });
    expect(names(r.items)).toEqual(["미완료 날짜", "경계 시작", "경계 끝"]);
  });

  it("works with only one end of the range", async () => {
    const s = () => setup(list(ROWS), { sessionPath: d.path });
    expect(names((await s().api.listTasks({ dueFrom: "2026-10-20" })).items)).toEqual(["범위 밖", "경계 끝"]); // 벨루가 준 순서를 그대로 유지
    expect(names((await s().api.listTasks({ dueTo: "2026-10-10" })).items)).toEqual(["경계 시작"]);
  });

  it("a free-text deadline is returned exactly as written and is not turned into a date", async () => {
    const t = (await setup(list([task(3, { deadline: "이번 주 안에" })]), { sessionPath: d.path }).api.listTasks()).items[0]!;
    expect(t.deadline).toBe("이번 주 안에");
    expect(t.dueDate).toBeNull();
  });

  it("things that look like dates but are not exactly YYYY-MM-DD stay free text", async () => {
    const odd = ["2026-10-13T09:00", "10/13", "2026-02-30", "내일", " 2026-10-13"];
    const r = await setup(list(odd.map((x, i) => task(i + 1, { deadline: x }))), { sessionPath: d.path }).api.listTasks();
    expect(r.items.map((t) => t.dueDate)).toEqual([null, null, null, null, null]);
    expect(r.items.map((t) => t.deadline)).toEqual(odd);
  });

  it("the limit cuts the list and says how many were left out", async () => {
    const many = Array.from({ length: 5 }, (_, i) => task(i + 1));
    const r = await setup(list(many), { sessionPath: d.path }).api.listTasks({ maxResults: 2 });
    expect(r).toMatchObject({ truncated: true, omitted: 3 });
    expect(r.items).toHaveLength(2);
  });

  it("rejects impossible or reversed dates before any request", async () => {
    const s = setup(list([]), { sessionPath: d.path });
    for (const bad of [{ dueFrom: "내일" }, { dueTo: "2026-02-30" }, { dueFrom: "2026-10-20", dueTo: "2026-10-10" }]) {
      await expect(s.api.listTasks(bad)).rejects.toMatchObject({ code: "validation_error" });
    }
    expect(s.requests).toHaveLength(0);
  });

  it("isRealDate", () => {
    expect(isRealDate("2026-10-13")).toBe(true);
    for (const bad of ["2026-13-01", "2026-02-30", "2026-1-3", "", "오늘"]) expect(isRealDate(bad), bad).toBe(false);
  });
});

describe("response shape check", () => {
  it("a missing required field is a contract change that names the field but not the value", async () => {
    const { done: _omit, ...withoutDone } = task(1, { name: "극비 이름" });
    void _omit;
    const err = await setup(list([withoutDone]), { sessionPath: d.path }).api.listTasks().catch((e: Error) => e);
    expect(err).toMatchObject({ code: "contract_changed" });
    expect(String((err as Error).message)).toContain("done");
    expect(JSON.stringify(err)).not.toContain("극비");
  });

  it("wrong types are caught (priority as a number, id as a string, done as text)", async () => {
    for (const bad of [{ priority: 1 }, { id: "7" }, { done: "false" }, { created_at: "not a date" }, { deadline: null }, { memo: null }]) {
      await expect(setup(list([task(1, bad)]), { sessionPath: d.path }).api.listTasks(), JSON.stringify(bad)).rejects.toMatchObject({ code: "contract_changed" });
    }
  });

  it("one bad row makes the whole answer an error instead of silently dropping it", async () => {
    await expect(setup(list([task(1), { id: 2 }, task(3)]), { sessionPath: d.path }).api.listTasks()).rejects.toMatchObject({ code: "contract_changed" });
  });

  it("an empty list is fine", async () => {
    expect(await setup(list([]), { sessionPath: d.path }).api.listTasks()).toMatchObject({ items: [], truncated: false });
  });

  it("a non-JSON body is a contract change", async () => {
    const s = setup((r) => (r.path === "/todo/api/todos" ? new Response("<html>login</html>", { status: 200 }) : undefined), { sessionPath: d.path });
    await expect(s.api.listTasks()).rejects.toMatchObject({ code: "contract_changed" });
  });
});

describe("veloo_weekly_review", () => {
  const review = (body: unknown) => (r: Req) => (r.path === "/todo/api/reviews/weekly" ? json(body) : undefined);
  const FULL = { week_start: "2026-10-05T00:00:00+09:00", week_end: "2026-10-12T00:00:00+09:00", completed: 4, created: 6, completion_rate: 0.667, overdue: [{ id: 1, name: "밀림" }, { id: 2, name: "밀림2" }, { id: 3, name: "밀림3" }], by_priority: { urgent: { done: 1, todo: 2 }, mid: { done: 0, todo: 0 }, normal: { done: 3, todo: 1 } } };

  it("returns completed, created and the number of overdue tasks for the week", async () => {
    const s = setup(review(FULL), { sessionPath: d.path });
    const r = await s.api.weeklyReview({ weekStart: "2026-10-05" });
    expect(r).toEqual({ weekStart: "2026-10-05", completed: 4, created: 6, overdue: 3, completionRate: 0.667 });
    expect(r).not.toHaveProperty("byPriority"); // 벨루의 by_priority는 주와 상관없는 전체 값이라 돌려주지 않는다
    const g = s.gets()[0]!;
    expect(g.path).toBe("/todo/api/reviews/weekly");
    expect(new URLSearchParams(g.search).get("week_start")).toBe("2026-10-05T00:00:00+09:00"); // 한국 시간 그날 00:00, '+'가 깨지지 않게 인코딩
  });

  it("does not return the overdue task names, only the count", async () => {
    expect(JSON.stringify(await setup(review(FULL), { sessionPath: d.path }).api.weeklyReview({ weekStart: "2026-10-05" }))).not.toContain("밀림");
  });

  it("a wrong date format is an input error and nothing is requested", async () => {
    const s = setup(review(FULL), { sessionPath: d.path });
    for (const bad of ["지난주", "2026-10-5", "2026-02-30", "", "2026-10-05T00:00:00+09:00"]) {
      await expect(s.api.weeklyReview({ weekStart: bad }), bad).rejects.toMatchObject({ code: "validation_error" });
    }
    expect(s.requests).toHaveLength(0);
  });

  it("missing counts are a contract change", async () => {
    for (const bad of [{ ...FULL, completed: undefined }, { ...FULL, created: "6" }, { ...FULL, overdue: 3 }, []]) {
      await expect(setup(review(bad), { sessionPath: d.path }).api.weeklyReview({ weekStart: "2026-10-05" })).rejects.toMatchObject({ code: "contract_changed" });
    }
  });

  it("optional parts may be absent", async () => {
    const r = await setup(review({ completed: 0, created: 0, overdue: [] }), { sessionPath: d.path }).api.weeklyReview({ weekStart: "2026-10-05" });
    expect(r).toEqual({ weekStart: "2026-10-05", completed: 0, created: 0, overdue: 0, completionRate: null });
  });
});
