// my-task original code (not derived from upstream).
import type { SourceModules } from "../src/modules";

export interface Call {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

/** 소스 모듈 함수 하나의 가짜 답. Error를 돌려주면 던진다. */
export type Handler = (server: string, tool: string, args: Record<string, unknown>) => unknown;

/**
 * 가짜 소스 모듈. 모든 호출을 (모듈, 함수 이름, 인자 객체)로 기록하고 `handler`의 답을 돌려준다.
 * 인자가 객체가 아닌 함수는 객체로 바꿔 기록한다: `readEmail(id)` → `{ id }`, `sendManyToMe(messages, opts)` → `{ messages, dryRun }`.
 */
export function fakeModules(handler: Handler): { modules: SourceModules; calls: Call[] } {
  const calls: Call[] = [];
  const fn = (server: string, tool: string, toArgs: (...a: unknown[]) => Record<string, unknown> = (a) => (a ?? {}) as Record<string, unknown>) =>
    async (...a: unknown[]) => {
      const args = toArgs(...a);
      calls.push({ server, tool, args });
      const out = await handler(server, tool, args);
      if (out instanceof Error) throw out;
      return out;
    };
  const modules = {
    todo: { listTaskLists: fn("todo", "listTaskLists"), listTasks: fn("todo", "listTasks"), getTask: fn("todo", "getTask"), listTasksDue: fn("todo", "listTasksDue"), createTask: fn("todo", "createTask") },
    gmail: { searchEmails: fn("gmail", "searchEmails"), readEmail: fn("gmail", "readEmail", (id) => ({ id })) },
    github: { listReviewRequests: fn("github", "listReviewRequests"), listAssignedItems: fn("github", "listAssignedItems"), listNotifications: fn("github", "listNotifications") },
    folio: { listRecentPapers: fn("folio", "listRecentPapers"), searchPapers: fn("folio", "searchPapers") },
    kakao: { sendManyToMe: fn("kakao", "sendManyToMe", (messages, opts) => ({ messages, dryRun: (opts as { dryRun?: boolean } | undefined)?.dryRun })) },
    server: { listTargets: fn("server", "listTargets"), checkServices: fn("server", "checkServices"), checkLlm: fn("server", "checkLlm"), summarizeDockerLogs: fn("server", "summarizeDockerLogs") },
  } as unknown as SourceModules;
  return { modules, calls };
}
