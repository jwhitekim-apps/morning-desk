// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import type { GraphClient } from "../src/graph/client";
import { AppError } from "../src/graph/errors";
import { TasksApi } from "../src/todo/tasks";

interface Call {
  method: string;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
}

/** 서버가 가진 태스크를 흉내 낸다. POST는 저장하고, GET은 저장된 것을 돌려준다. */
function fakeServer(initial: Record<string, unknown>[] = [], opts: { rejectFilter?: boolean } = {}) {
  const stored = [...initial];
  const calls: Call[] = [];
  const graph = {
    request: async (method: string, path: string, o: { query?: Record<string, unknown>; body?: unknown } = {}) => {
      calls.push({ method, path, query: o.query, body: o.body });
      if (method === "POST") {
        const made = { id: `new${stored.length}`, status: "notStarted", ...(o.body as object) };
        stored.push(made);
        return made;
      }
      if (opts.rejectFilter && o.query?.$filter) throw new AppError("graph_error", "bad filter", { status: 400 });
      return { value: o.query?.$filter ? stored.filter((t) => t.status !== "completed") : stored };
    },
  } as unknown as GraphClient;
  return { graph, api: new TasksApi(graph, 100), stored, calls, posts: () => calls.filter((c) => c.method === "POST") };
}

// 앱에서 날짜만 고른 마감(한국 10/13 자정)
const DUE_1013 = { dateTime: "2026-10-12T15:00:00.0000000", timeZone: "UTC" };
const existing = (title: string, due: unknown = DUE_1013, status = "notStarted") => ({
  id: "old",
  title,
  status,
  ...(due ? { dueDateTime: due } : {}),
});

describe("createUnique", () => {
  it("does not create when the same title and due date already exist, and returns the existing task", async () => {
    const { api, posts } = fakeServer([existing("랩미팅")]);
    const r = await api.createUnique({ listId: "L", title: "랩미팅", dueDateTime: "2026-10-13" });
    expect(r).toMatchObject({ id: "old", title: "랩미팅", alreadyExisted: true, dueDate: "2026-10-13" });
    expect(posts()).toHaveLength(0);
  });

  it("ignores case and surrounding spaces in the title", async () => {
    const { api, posts } = fakeServer([existing("Lab Meeting")]);
    const r = await api.createUnique({ listId: "L", title: "  lab meeting ", dueDateTime: "2026-10-13" });
    expect(r.alreadyExisted).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it("matches on the due DATE, so a time of day does not make it a different task", async () => {
    const { api, posts } = fakeServer([existing("랩미팅")]);
    const r = await api.createUnique({ listId: "L", title: "랩미팅", dueDateTime: "2026-10-13T15:00" });
    expect(r.alreadyExisted).toBe(true);
    expect(posts()).toHaveLength(0);
  });

  it("creates when only the title matches and the due date differs", async () => {
    const { api, posts } = fakeServer([existing("랩미팅")]);
    const r = await api.createUnique({ listId: "L", title: "랩미팅", dueDateTime: "2026-10-14" });
    expect(r.alreadyExisted).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it("creates when the due date matches and the title differs", async () => {
    const { api, posts } = fakeServer([existing("랩미팅")]);
    expect((await api.createUnique({ listId: "L", title: "세미나", dueDateTime: "2026-10-13" })).alreadyExisted).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it("treats 'no due date' as its own value: two undated tasks with one title are duplicates, dated vs undated are not", async () => {
    const { api, posts } = fakeServer([existing("메모", null)]);
    expect((await api.createUnique({ listId: "L", title: "메모" })).alreadyExisted).toBe(true);
    expect((await api.createUnique({ listId: "L", title: "메모", dueDateTime: "2026-10-13" })).alreadyExisted).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it("a completed task with the same title and date does not block a new one", async () => {
    const { api, posts } = fakeServer([existing("랩미팅", DUE_1013, "completed")]);
    expect((await api.createUnique({ listId: "L", title: "랩미팅", dueDateTime: "2026-10-13" })).alreadyExisted).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it("holds after a restart: a fresh API object sees what the first one created", async () => {
    const server = fakeServer();
    const first = await server.api.createUnique({ listId: "L", title: "랩미팅", dueDateTime: "2026-10-13" });
    expect(first.alreadyExisted).toBe(false);
    // 서버 재시작 = 프로세스 안의 캐시가 사라짐. 같은 Graph 상태를 보는 새 객체로 흉내 낸다.
    const restarted = new TasksApi(server.graph, 100);
    const second = await restarted.createUnique({ listId: "L", title: "랩미팅", dueDateTime: "2026-10-13" });
    expect(second.alreadyExisted).toBe(true);
    expect(server.posts()).toHaveLength(1);
  });

  it("still guards when Graph rejects the status filter (reads everything and filters itself)", async () => {
    const { api, posts } = fakeServer([existing("랩미팅"), existing("끝", DUE_1013, "completed")], { rejectFilter: true });
    expect((await api.createUnique({ listId: "L", title: "랩미팅", dueDateTime: "2026-10-13" })).alreadyExisted).toBe(true);
    expect((await api.createUnique({ listId: "L", title: "끝", dueDateTime: "2026-10-13" })).alreadyExisted).toBe(false);
    expect(posts()).toHaveLength(1);
  });

  it("creates nothing if the existing tasks cannot be read", async () => {
    const calls: string[] = [];
    const graph = {
      request: async (method: string) => {
        calls.push(method);
        throw new AppError("graph_unavailable", "down", { status: 503 });
      },
    } as unknown as GraphClient;
    await expect(new TasksApi(graph, 100).createUnique({ listId: "L", title: "x" })).rejects.toMatchObject({ code: "graph_unavailable" });
    expect(calls).not.toContain("POST");
  });

  it("rejects an impossible due date before calling Graph at all", async () => {
    const { api, calls } = fakeServer();
    await expect(api.createUnique({ listId: "L", title: "x", dueDateTime: "2026-02-30" })).rejects.toMatchObject({ code: "validation_error" });
    expect(calls).toHaveLength(0);
  });
});
