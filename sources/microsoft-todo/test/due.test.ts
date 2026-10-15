// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import type { GraphClient } from "../src/graph/client";
import { AppError } from "../src/graph/errors";
import { DueTasksApi } from "../src/todo/due";
import { TaskListsApi } from "../src/todo/lists";
import { TasksApi } from "../src/todo/tasks";

type Respond = (listId: string, query: Record<string, unknown> | undefined) => unknown;

/** 목록 둘 이상을 가진 가짜 Graph. 목록별 응답은 `tasksOf`가 정한다. */
function fakeApis(lists: { id: string; displayName: string }[], tasksOf: Respond) {
  const calls: { path: string; query?: Record<string, unknown> }[] = [];
  const graph = {
    request: async (_method: string, path: string, opts: { query?: Record<string, unknown> } = {}) => {
      calls.push({ path, query: opts.query });
      if (path === "/me/todo/lists") return { value: lists };
      const m = /\/me\/todo\/lists\/([^/]+)\/tasks/.exec(path);
      if (!m) throw new Error(`unexpected path ${path}`);
      const out = tasksOf(decodeURIComponent(m[1] as string), opts.query);
      if (out instanceof Error) throw out;
      return out;
    },
  } as unknown as GraphClient;
  return { due: new DueTasksApi(new TaskListsApi(graph, 100), new TasksApi(graph, 100)), calls };
}

/** 한국 날짜 하루(자정)를 앱이 저장하는 UTC 모양으로. */
const dueOn = (ymd: string) => {
  const iso = new Date(`${ymd}T00:00:00+09:00`).toISOString(); // 2026-10-12T15:00:00.000Z
  return { dateTime: `${iso.slice(0, 19)}.0000000`, timeZone: "UTC" };
};
const task = (id: string, title: string, ymd?: string, status = "notStarted") => ({
  id,
  title,
  status,
  ...(ymd ? { dueDateTime: dueOn(ymd) } : {}),
});

const LISTS = [
  { id: "A", displayName: "작업" },
  { id: "B", displayName: "개인" },
];

describe("listDue", () => {
  it("collects open tasks from every list, sorted by due then title, with the list name", async () => {
    const { due } = fakeApis(LISTS, (id) =>
      id === "A"
        ? { value: [task("a1", "다", "2026-10-14"), task("a2", "가", "2026-10-13")] }
        : { value: [task("b1", "나", "2026-10-13"), task("b2", "범위 밖", "2026-10-20")] },
    );
    const r = await due.listDue({ from: "2026-10-12", to: "2026-10-18" });
    expect(r.items.map((t) => [t.title, t.listName, t.dueDate, t.overdue])).toEqual([
      ["가", "작업", "2026-10-13", false],
      ["나", "개인", "2026-10-13", false],
      ["다", "작업", "2026-10-14", false],
    ]);
    expect(r).toMatchObject({ total: 3, truncated: false, omitted: 0, failedLists: [], unconvertible: 0 });
  });

  it("includes both ends of the range as Korea dates", async () => {
    const { due } = fakeApis([LISTS[0]!], () => ({ value: [task("x", "첫날", "2026-10-13"), task("y", "끝날", "2026-10-14"), task("z", "다음날", "2026-10-15")] }));
    const r = await due.listDue({ from: "2026-10-13", to: "2026-10-14" });
    expect(r.items.map((t) => t.title)).toEqual(["첫날", "끝날"]);
  });

  it("a task due Korea 00:30 on the 13th (still the 12th in UTC) belongs to the 13th", async () => {
    const early = { id: "e", title: "새벽", status: "notStarted", dueDateTime: { dateTime: "2026-10-12T15:30:00.0000000", timeZone: "UTC" } };
    const { due } = fakeApis([LISTS[0]!], () => ({ value: [early] }));
    expect((await due.listDue({ from: "2026-10-13", to: "2026-10-13" })).items).toHaveLength(1);
    expect((await due.listDue({ from: "2026-10-12", to: "2026-10-12" })).items).toHaveLength(0);
  });

  it("leaves out tasks without a due date and completed tasks, even if the server filter did not apply", async () => {
    const { due } = fakeApis([LISTS[0]!], () => ({
      value: [task("n", "마감 없음"), task("c", "끝난 일", "2026-10-13", "completed"), task("ok", "남은 일", "2026-10-13")],
    }));
    const r = await due.listDue({ from: "2026-10-13", to: "2026-10-13" });
    expect(r.items.map((t) => t.title)).toEqual(["남은 일"]);
  });

  it("asks Graph to exclude completed tasks", async () => {
    const { due, calls } = fakeApis([LISTS[0]!], () => ({ value: [] }));
    await due.listDue({ from: "2026-10-13", to: "2026-10-13" });
    expect(calls.find((c) => c.path.endsWith("/tasks"))?.query?.$filter).toBe("status ne 'completed'");
  });

  it("falls back to reading everything when Graph rejects the filter with 400", async () => {
    const { due, calls } = fakeApis([LISTS[0]!], (_id, query) =>
      query?.$filter ? new AppError("graph_error", "bad filter", { status: 400 }) : { value: [task("t", "된다", "2026-10-13"), task("c", "끝", "2026-10-13", "completed")] },
    );
    const r = await due.listDue({ from: "2026-10-13", to: "2026-10-13" });
    expect(r.items.map((t) => t.title)).toEqual(["된다"]);
    expect(r.failedLists).toEqual([]);
    expect(calls.filter((c) => c.path.endsWith("/tasks"))).toHaveLength(2);
  });

  it("overdue tasks are only included on request, and are marked", async () => {
    const { due } = fakeApis([LISTS[0]!], () => ({ value: [task("o", "밀림", "2026-10-01"), task("n", "오늘", "2026-10-13")] }));
    const without = await due.listDue({ from: "2026-10-13", to: "2026-10-13" });
    expect(without.items.map((t) => t.title)).toEqual(["오늘"]);
    const withOverdue = await due.listDue({ from: "2026-10-13", to: "2026-10-13", includeOverdue: true });
    expect(withOverdue.items.map((t) => [t.title, t.overdue])).toEqual([["밀림", true], ["오늘", false]]);
  });

  it("truncates at the limit and says how many were left out", async () => {
    const many = Array.from({ length: 5 }, (_, i) => task(`t${i}`, `일 ${i}`, "2026-10-13"));
    const { due } = fakeApis([LISTS[0]!], () => ({ value: many }));
    const r = await due.listDue({ from: "2026-10-13", to: "2026-10-13", maxResults: 2 });
    expect(r).toMatchObject({ total: 5, truncated: true, omitted: 3 });
    expect(r.items).toHaveLength(2);
  });

  it("one failing list does not hide the others, and is named in the result", async () => {
    const { due } = fakeApis(LISTS, (id) => (id === "A" ? new AppError("rate_limited", "slow down") : { value: [task("b", "된다", "2026-10-13")] }));
    const r = await due.listDue({ from: "2026-10-13", to: "2026-10-13" });
    expect(r.items.map((t) => t.title)).toEqual(["된다"]);
    expect(r.failedLists).toEqual([{ listId: "A", listName: "작업", error: "slow down" }]);
  });

  it("counts tasks whose time zone could not be converted instead of dropping them silently", async () => {
    const odd = { id: "o", title: "이상", status: "notStarted", dueDateTime: { dateTime: "2026-10-13T00:00:00", timeZone: "Mars/Olympus" } };
    const { due } = fakeApis([LISTS[0]!], () => ({ value: [odd] }));
    const r = await due.listDue({ from: "2026-10-13", to: "2026-10-13" });
    expect(r).toMatchObject({ items: [], unconvertible: 1 });
  });

  it("rejects bad input before calling Graph", async () => {
    const { due, calls } = fakeApis(LISTS, () => ({ value: [] }));
    for (const [from, to] of [["내일", "2026-10-13"], ["2026-02-30", "2026-03-01"], ["2026-10-14", "2026-10-13"]]) {
      await expect(due.listDue({ from: from as string, to: to as string })).rejects.toMatchObject({ code: "validation_error" });
    }
    await expect(due.listDue({ from: "2026-10-13", to: "2026-10-13", maxResults: 5000 })).rejects.toMatchObject({ code: "validation_error" });
    expect(calls).toHaveLength(0);
  });
});
