// my-task original code (not derived from upstream): the module entry that replaces the MCP server (src/server.ts) and its tools.
// It wires the adapted upstream pieces (auth, Graph client, task APIs) and exposes only read + create to the app.
import type { PublicClientApplication } from "@azure/msal-node";
import { AuthManager } from "./auth/auth-state";
import { acquireByDeviceCode, createPca, getCachedAccount, type DeviceCodeInfo } from "./auth/device-code";
import { clearCache, openTokenEnv } from "./auth/token-cache";
import { scopesFor, type AppConfig } from "./config";
import { GraphClient } from "./graph/client";
import { AppError } from "./graph/errors";
import { systemClock, type Clock } from "./lib/clock";
import { IdempotencyCache } from "./lib/idempotency";
import { cryptoIds, type IdGenerator } from "./lib/ids";
import { createLogger, type Logger } from "./lib/logger";
import { DateTimeInput } from "./lib/schema";
import { DueTasksApi, type DueTasksResult } from "./todo/due";
import { TaskListsApi } from "./todo/lists";
import { TasksApi, type CreateTaskInput, type KstTask } from "./todo/tasks";
import type { TaskList } from "./todo/types";

export { loadConfig, scopesFor, type AppConfig as TodoConfig } from "./config";
export { AppError as TodoError, type ErrorCode as TodoErrorCode } from "./graph/errors";
export { LOGIN_HINT, type AuthStatus } from "./auth/auth-state";
export { DEFAULT_DUE_LIMIT, MAX_DUE_LIMIT, type DueTask, type DueTasksResult } from "./todo/due";
export type { CreateTaskInput, KstTask } from "./todo/tasks";
export type { TaskList } from "./todo/types";
export { VERSION } from "./version";

const IDEMPOTENCY_TTL_MS = 60_000;
const MAX_LIST_RESULTS = 1000;

/**
 * 앱이 Microsoft To Do에 대해 할 수 있는 일의 전부: 읽기와 새 태스크 추가.
 * 태스크 수정, 완료, 삭제, 목록 만들기·바꾸기·지우기, 체크리스트는 없다.
 * 로그인되어 있지 않으면 로그인을 시작하지 않고 `auth_required`와 `morning-desk login todo` 안내를 던진다.
 * 날짜만 주면 한국 날짜, 시간대 없는 일시는 한국 시간이다.
 */
export interface TodoSource {
  listTaskLists(input?: { cursor?: string; maxResults?: number }): Promise<{ items: TaskList[]; hasMore: boolean; cursor?: string }>;
  listTasks(input: {
    listId: string;
    status?: "all" | "notStarted" | "inProgress" | "completed";
    includeChecklist?: boolean;
    includeLinkedResources?: boolean;
    cursor?: string;
    maxResults?: number;
  }): Promise<{ items: KstTask[]; hasMore: boolean; cursor?: string }>;
  getTask(input: { listId: string; taskId: string; includeChecklist?: boolean; includeLinkedResources?: boolean }): Promise<KstTask>;
  /** 모든 목록에서 [from, to](한국 날짜)에 마감인 미완료 태스크, 마감순. `failedLists`가 비어 있지 않으면 결과가 불완전하다. */
  listTasksDue(input: { from: string; to: string; includeOverdue?: boolean; maxResults?: number }): Promise<DueTasksResult>;
  /**
   * 새 태스크. 같은 목록에 제목(앞뒤 공백·대소문자 무시)과 마감(한국 날짜)이 같은 미완료 태스크가 있으면 만들지 않고 그것을
   * `alreadyExisted: true`로 돌려준다. 같은 실행에서 1분 안에 같은 요청을 다시 보내면 처음 결과를 `_idempotent: true`로 돌려준다.
   */
  createTask(input: CreateTaskInput): Promise<KstTask & { alreadyExisted: boolean; _idempotent?: true }>;
}

/** 앱에 내보내는 함수의 허용 목록. 더하려면 이 목록과 명세(`microsoft-todo-tools`)를 의도적으로 고친다. */
export const TODO_ALLOWED = ["createTask", "getTask", "listTaskLists", "listTasks", "listTasksDue"] as const;

export interface TodoDeps {
  /** To Do 모듈은 외부 출처 코드의 로거(값을 가리는 방식)를 그대로 쓴다. 없으면 설정의 로그 수준으로 만든다. */
  logger?: Logger;
  ids?: IdGenerator;
  clock?: Clock;
  fetchImpl?: typeof fetch;
  /** 테스트용: MSAL 대신 쓸 객체. */
  pca?: PublicClientApplication | null;
}

const clampMax = (n: number | undefined): number | undefined => (n === undefined ? undefined : Math.min(Math.max(Math.floor(n), 1), MAX_LIST_RESULTS));

/** 예전에는 도구 입력 모양(zod)이 막던 검사를 함수 입구에서 한다. */
function checkCreate(input: CreateTaskInput): CreateTaskInput {
  if (typeof input.listId !== "string" || !input.listId) throw new AppError("validation_error", "listId is required.");
  if (typeof input.title !== "string" || !input.title.trim()) throw new AppError("validation_error", "Task title is empty.");
  const out: CreateTaskInput = { ...input };
  for (const key of ["dueDateTime", "reminderDateTime"] as const) {
    if (input[key] === undefined) continue;
    const parsed = DateTimeInput.safeParse(input[key]);
    if (!parsed.success) throw new AppError("validation_error", `${key} must be YYYY-MM-DD, an ISO 8601 date-time, or { dateTime, timeZone }.`);
    out[key] = parsed.data;
  }
  return out;
}

export function createTodoSource(config: AppConfig, deps: TodoDeps = {}): TodoSource {
  const logger = deps.logger ?? createLogger(config.logLevel);
  const ids = deps.ids ?? cryptoIds;
  const clock = deps.clock ?? systemClock;
  const pca = deps.pca !== undefined ? deps.pca : config.clientId ? createPca(config, logger) : null;
  const configError = pca ? undefined : "No Microsoft Entra client ID configured. Set MS_TODO_CLIENT_ID (see docs/upstream/ENTRA-APP-SETUP.md).";
  const auth = new AuthManager(pca, scopesFor(config), logger, () => clock.now(), configError);
  let ready: Promise<void> | null = null;
  const init = () => (ready ??= auth.init());

  const graph = new GraphClient({ config, tokens: auth, logger, ids, fetchImpl: deps.fetchImpl });
  const lists = new TaskListsApi(graph, config.maxResults);
  const tasks = new TasksApi(graph, config.maxResults);
  const due = new DueTasksApi(lists, tasks);
  const idempotency = new IdempotencyCache(clock, IDEMPOTENCY_TTL_MS);

  return {
    async listTaskLists(input = {}) {
      await init();
      return lists.list({ cursor: input.cursor, maxResults: clampMax(input.maxResults), traceId: ids.uuid() });
    },
    async listTasks(input) {
      await init();
      return tasks.list(input.listId, {
        status: input.status,
        includeChecklist: input.includeChecklist,
        includeLinkedResources: input.includeLinkedResources,
        cursor: input.cursor,
        maxResults: clampMax(input.maxResults),
        traceId: ids.uuid(),
      });
    },
    async getTask(input) {
      await init();
      return tasks.get(input.listId, input.taskId, { includeChecklist: input.includeChecklist, includeLinkedResources: input.includeLinkedResources, traceId: ids.uuid() });
    },
    async listTasksDue(input) {
      await init();
      return due.listDue({ from: input.from, to: input.to, includeOverdue: input.includeOverdue, maxResults: input.maxResults, traceId: ids.uuid() });
    },
    async createTask(input) {
      const checked = checkCreate(input);
      await init();
      // 같은 실행의 재시도는 처음 결과를 돌려준다(예전 MCP 도구 층의 `withIdempotency`를 옮김).
      const key = IdempotencyCache.key({ tool: "create_task", args: checked, accountId: auth.accountId() });
      const cached = idempotency.get<KstTask & { alreadyExisted: boolean }>(key);
      if (cached !== undefined) return { ...cached, _idempotent: true as const };
      const result = await tasks.createUnique(checked, ids.uuid());
      idempotency.set(key, result);
      return result;
    },
  };
}

/**
 * 사람이 터미널에서 실행하는 로그인 명령용. 하루 실행(`run`)은 이것을 받지 않는다.
 * 기기 코드 로그인을 시작하는 곳은 여기 한 곳뿐이다. 토큰 캐시는 `.env.local`의 `MS_TODO_TOKEN_CACHE_DATA` 줄에만 쓴다.
 */
export const todoAuth = {
  /** 기기 코드 로그인. 열 주소와 코드는 `onCode`로 알린다. 성공하면 계정 이름을 돌려준다. */
  async login(config: AppConfig, onCode: (info: DeviceCodeInfo) => void): Promise<{ username: string | undefined }> {
    const result = await acquireByDeviceCode(createPca(config, createLogger(config.logLevel)), scopesFor(config), onCode);
    return { username: result.account?.username };
  },
  /** 저장된 로그인(토큰 캐시 줄)을 지운다. */
  logout: (config: AppConfig): Promise<void> => clearCache(openTokenEnv(config.envFilePath)),
  /** 로그인된 계정(네트워크 없음, 토큰 값은 돌려주지 않는다). 없으면 null. */
  async whoami(config: AppConfig): Promise<{ username: string; name?: string; tenantId: string } | null> {
    const account = await getCachedAccount(createPca(config, createLogger(config.logLevel)));
    return account ? { username: account.username, name: account.name, tenantId: account.tenantId } : null;
  },
};
