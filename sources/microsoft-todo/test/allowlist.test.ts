// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig, scopesFor } from "../src/config";
import { createTodoSource, TODO_ALLOWED } from "../src/index";
import { createLogger } from "../src/lib/logger";

// 이 프로젝트의 위임 정책: 앱에는 읽기와 태스크 "추가"만 준다.
// 함수가 내보내지지 않으면 앱이 실수로도 부를 수 없다. 새 함수를 더하려면 이 목록과 명세를 의도적으로 고쳐야 한다.
const ALLOWED = ["createTask", "getTask", "listTaskLists", "listTasks", "listTasksDue"];

const silent = createLogger("silent");
const config = { ...loadConfig({ MY_TASK_ENV_FILE: "/nonexistent/.env.local" }), logLevel: "silent" };

const account = { username: "u@example.com", homeAccountId: "home-1", tenantId: "tenant-1" };

/** 로그인된 계정과 토큰을 가진 가짜 MSAL, 기록하는 가짜 Graph. */
function world(mode: "ok" | "read-only-grant" = "ok") {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let created = 0;
  const pca = {
    getTokenCache: () => ({ getAllAccounts: async () => [account] }),
    acquireTokenSilent: async () => ({ accessToken: "tok", expiresOn: new Date(Date.now() + 3_600_000), account }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ method, url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method === "POST") {
      // 읽기 권한만 받은 토큰이면 Graph가 쓰기를 403으로 거부한다.
      if (mode === "read-only-grant") return new Response(JSON.stringify({ error: { code: "Forbidden", message: "Access denied" } }), { status: 403, headers: { "content-type": "application/json" } });
      created += 1;
      return new Response(JSON.stringify({ id: `t${created}`, title: "랩미팅", status: "notStarted", dueDateTime: { dateTime: "2026-10-13T00:00:00.0000000", timeZone: "Asia/Seoul" } }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return new Response(JSON.stringify({ value: [] }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const todo = createTodoSource(config, { logger: silent, pca, fetchImpl });
  return { todo, calls, posts: () => calls.filter((c) => c.method === "POST") };
}

describe("the module surface", () => {
  it("exports exactly the allowed functions", () => {
    expect(Object.keys(world().todo).sort()).toEqual(ALLOWED);
    expect([...TODO_ALLOWED].sort()).toEqual(ALLOWED);
  });

  it("has no function that edits, completes or deletes existing items, and no sign-in function", () => {
    const names = Object.keys(world().todo);
    for (const forbidden of ["updateTask", "completeTask", "deleteTask", "createTaskList", "updateTaskList", "deleteTaskList", "signIn", "authStatus"]) {
      expect(names).not.toContain(forbidden);
    }
    for (const name of names) expect(name).not.toMatch(/update|complete|delete|remove|checklist|sign/i);
  });

  it("no source file filters functions with a read-only or no-destructive switch", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
    const src = fileURLToPath(new URL("../src", import.meta.url));
    for (const f of files(src)) {
      // 주석(변경 기록)은 빼고 코드만 본다.
      const code = readFileSync(f, "utf-8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(code, f).not.toMatch(/noDestructive|MS_TODO_READONLY|MS_TODO_NO_DESTRUCTIVE|\.readonly\b|\breadonly:/);
    }
  });
});

describe("createTask checks its input and keeps the in-run retry guard", () => {
  it("rejects an empty title and a malformed date before calling Graph", async () => {
    const { todo, calls } = world();
    await expect(todo.createTask({ listId: "L1", title: "  " })).rejects.toMatchObject({ code: "validation_error" });
    await expect(todo.createTask({ listId: "L1", title: "x", dueDateTime: 42 as never })).rejects.toMatchObject({ code: "validation_error" });
    expect(calls).toEqual([]);
  });

  it("a retried request in the same run returns the first result and creates one task", async () => {
    const { todo, posts } = world();
    const first = await todo.createTask({ listId: "L1", title: "랩미팅", dueDateTime: "2026-10-13" });
    const second = await todo.createTask({ listId: "L1", title: "랩미팅", dueDateTime: "2026-10-13" });
    expect(posts()).toHaveLength(1);
    expect(second.id).toBe(first.id);
    expect(second._idempotent).toBe(true);
  });

  it("a date alone is stored as that Korea date", async () => {
    const { todo, posts } = world();
    await todo.createTask({ listId: "L1", title: "랩미팅", dueDateTime: "2026-10-13" });
    expect((posts()[0]!.body as { dueDateTime: unknown }).dueDateTime).toEqual({ dateTime: "2026-10-13T00:00:00.0000000", timeZone: "Asia/Seoul" });
  });
});

describe("read-only permission", () => {
  it("the read-only scope setting asks Microsoft for Tasks.Read only; the default asks for Tasks.ReadWrite only", () => {
    expect(scopesFor({ ...config, scopeReadonly: true })).toEqual(["Tasks.Read"]);
    expect(scopesFor({ ...config, scopeReadonly: false })).toEqual(["Tasks.ReadWrite"]);
  });

  it("with only read permission, createTask fails as permission_denied and nothing is created", async () => {
    const { todo, posts } = world("read-only-grant");
    await expect(todo.createTask({ listId: "L1", title: "랩미팅" })).rejects.toMatchObject({ code: "permission_denied" });
    expect(posts()).toHaveLength(1); // 요청은 Graph가 거부했다
  });
});
