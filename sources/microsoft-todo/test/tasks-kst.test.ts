// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import type { GraphClient } from "../src/graph/client";
import { toGraphUtc } from "../src/lib/kst";
import { TasksApi } from "../src/todo/tasks";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
}

/** Graph를 흉내 내는 가짜. 호출을 기록하고, 준비한 응답을 돌려준다. */
function fakeGraph(respond: (call: Call) => unknown) {
  const calls: Call[] = [];
  const graph = {
    request: async (method: string, path: string, opts: { body?: unknown; query?: Record<string, unknown> } = {}) => {
      const call = { method, path, body: opts.body, query: opts.query };
      calls.push(call);
      return respond(call);
    },
  } as unknown as GraphClient;
  return { graph, calls };
}


/** 배열의 i번째 값을 돌려준다. 없으면 어느 위치가 비었는지 알려 주며 테스트를 실패시킨다. */
function at<T>(list: readonly T[], index: number): T {
  const value = list[index];
  if (value === undefined) throw new Error(`expected an element at index ${index}, but the list has ${list.length}`);
  return value;
}

// 실측한 모양: 앱에서 날짜만 고른 마감(한국 4/9 자정)이 UTC 전날 15:00으로 온다.
const REAL_SAMPLE = {
  id: "t1",
  title: "샘플",
  status: "notStarted",
  importance: "normal",
  dueDateTime: { dateTime: "2026-04-08T15:00:00.0000000", timeZone: "UTC" },
};

describe("TasksApi shows Korea time", () => {
  it("list: converts the real UTC sample to the day the user picked and adds dueDate", async () => {
    const { graph } = fakeGraph(() => ({ value: [REAL_SAMPLE] }));
    const { items } = await new TasksApi(graph, 100).list("L1");
    expect(at(items, 0).dueDate).toBe("2026-04-09");
    expect(at(items, 0).dueDateTime).toEqual({ dateTime: "2026-04-09T00:00:00", timeZone: "Asia/Seoul" });
  });

  it("get: converts due, reminder and completed date-times", async () => {
    const { graph } = fakeGraph(() => ({
      ...REAL_SAMPLE,
      reminderDateTime: { dateTime: "2026-10-13T06:00:00.0000000", timeZone: "UTC" },
      completedDateTime: { dateTime: "2026-10-12T15:30:00.0000000", timeZone: "UTC" },
    }));
    const task = await new TasksApi(graph, 100).get("L1", "t1");
    expect(task.reminderDateTime).toEqual({ dateTime: "2026-10-13T15:00:00", timeZone: "Asia/Seoul" });
    expect(task.completedDateTime).toEqual({ dateTime: "2026-10-13T00:30:00", timeZone: "Asia/Seoul" });
  });

  it("a task without dates is left alone", async () => {
    const { graph } = fakeGraph(() => ({ value: [{ id: "t2", title: "날짜 없음", status: "notStarted" }] }));
    const { items } = await new TasksApi(graph, 100).list("L1");
    expect(at(items, 0).dueDate).toBeUndefined();
    expect(at(items, 0).dueDateTime).toBeUndefined();
  });

  it("an unknown time zone on one task does not fail the whole list, and says so", async () => {
    const odd = { id: "t3", title: "이상한 시간대", status: "notStarted", dueDateTime: { dateTime: "2026-10-13T00:00:00", timeZone: "Mars/Olympus" } };
    const { graph } = fakeGraph(() => ({ value: [REAL_SAMPLE, odd] }));
    const { items } = await new TasksApi(graph, 100).list("L1");
    expect(items).toHaveLength(2);
    expect(at(items, 0).dueDate).toBe("2026-04-09");
    expect(at(items, 1).timeWarning).toMatch(/Korea time/);
    expect(at(items, 1).dueDateTime).toEqual({ dateTime: "2026-10-13T00:00:00", timeZone: "Mars/Olympus" });
  });
});

describe("TasksApi sends Korea-time dates for due and UTC for reminders", () => {
  const created = { id: "new", title: "새 태스크", status: "notStarted" };

  it("a due date is sent as that Korea date at Asia/Seoul midnight (Graph keeps only the date in the zone it is sent in)", async () => {
    const { graph, calls } = fakeGraph(() => created);
    await new TasksApi(graph, 100).create({ listId: "L1", title: "새 태스크", dueDateTime: "2026-10-13" });
    expect(at(calls, 0).method).toBe("POST");
    expect((at(calls, 0).body as { dueDateTime: unknown }).dueDateTime).toEqual({ dateTime: "2026-10-13T00:00:00.0000000", timeZone: "Asia/Seoul" });
  });

  it("a due date-time keeps only its Korea date: 00:30 on the 13th stays the 13th, not the 12th", async () => {
    const { graph, calls } = fakeGraph(() => created);
    await new TasksApi(graph, 100).create({ listId: "L1", title: "t", dueDateTime: "2026-10-13T00:30" });
    expect((at(calls, 0).body as { dueDateTime: unknown }).dueDateTime).toEqual({ dateTime: "2026-10-13T00:00:00.0000000", timeZone: "Asia/Seoul" });
  });

  it("a date-time without a zone is Korea time, whatever the host time zone is", async () => {
    const { graph, calls } = fakeGraph(() => created);
    await new TasksApi(graph, 100).create({
      listId: "L1",
      title: "새 태스크",
      dueDateTime: "2026-10-13",
      reminderDateTime: "2026-10-13T15:00",
    });
    const body = at(calls, 0).body as { reminderDateTime: unknown; isReminderOn: boolean };
    expect(body.reminderDateTime).toEqual({ dateTime: "2026-10-13T06:00:00.0000000", timeZone: "UTC" });
    expect(body.isReminderOn).toBe(true);
  });

  it("an explicit zone is honoured, then reduced to the Korea date for the due date", async () => {
    const { graph, calls } = fakeGraph(() => created);
    await new TasksApi(graph, 100).create({
      listId: "L1",
      title: "새 태스크",
      dueDateTime: { dateTime: "2026-07-01T12:00:00", timeZone: "America/New_York" },
    });
    expect((at(calls, 0).body as { dueDateTime: unknown }).dueDateTime).toEqual({ dateTime: "2026-07-02T00:00:00.0000000", timeZone: "Asia/Seoul" });
  });

  it("rejects an impossible date before calling Graph", async () => {
    const { graph, calls } = fakeGraph(() => created);
    await expect(new TasksApi(graph, 100).create({ listId: "L1", title: "x", dueDateTime: "2026-02-30" })).rejects.toMatchObject({ code: "validation_error" });
    expect(calls).toHaveLength(0);
  });

  it("what was sent reads back as the same Korea date, with Graph's real storage rule simulated", async () => {
    // 실측한 Graph 규칙: 마감은 보낸 시간대 기준의 날짜만 남고 그 시간대 자정으로 저장되어 UTC로 돌아온다.
    // 알림은 시각 그대로 저장된다.
    const stored: Record<string, unknown> = {};
    const { graph } = fakeGraph((call) => {
      if (call.method === "POST") {
        const body = call.body as { dueDateTime?: { dateTime: string; timeZone: string } };
        const due = body.dueDateTime && toGraphUtc({ dateTime: `${body.dueDateTime.dateTime.slice(0, 10)}T00:00:00`, timeZone: body.dueDateTime.timeZone });
        Object.assign(stored, { id: "x", title: "t", status: "notStarted" }, call.body, due ? { dueDateTime: due } : {});
      }
      return stored;
    });
    const api = new TasksApi(graph, 100);
    for (const [input, expected] of [["2026-10-13", "2026-10-13"], ["2026-10-13T00:30", "2026-10-13"], ["2026-10-13T23:59", "2026-10-13"]] as const) {
      const task = await api.create({ listId: "L1", title: "t", dueDateTime: input, reminderDateTime: "2026-10-13T09:00" });
      expect(task.dueDate, input).toBe(expected);
      expect(task.reminderDateTime).toEqual({ dateTime: "2026-10-13T09:00:00", timeZone: "Asia/Seoul" });
    }
  });

});
