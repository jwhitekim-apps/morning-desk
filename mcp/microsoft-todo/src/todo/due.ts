// my-task original code (not derived from upstream).
//
// 모든 목록에서 마감이 [from, to](한국 날짜)인 미완료 태스크를 한 번에 모은다.
import { AppError, toAppError } from "../graph/errors";
import { isYmd, toGraphUtc } from "../lib/kst";
import type { TaskListsApi } from "./lists";
import type { KstTask, TasksApi } from "./tasks";

export const DEFAULT_DUE_LIMIT = 200;
export const MAX_DUE_LIMIT = 1000;
const LIST_CONCURRENCY = 4;

export interface DueTasksOptions {
  /** 시작 날짜(한국), YYYY-MM-DD. */
  from: string;
  /** 끝 날짜(한국), YYYY-MM-DD. 이 날짜를 포함한다. */
  to: string;
  /** 시작 날짜보다 먼저 마감이 지난 미완료 태스크도 함께 돌려준다. */
  includeOverdue?: boolean;
  maxResults?: number;
  traceId?: string;
}

export type DueTask = KstTask & { listId: string; listName: string; overdue: boolean };

export interface DueTasksResult {
  from: string;
  to: string;
  items: DueTask[];
  /** 조건에 맞는 전체 개수(한도로 잘리기 전). */
  total: number;
  truncated: boolean;
  /** 한도 때문에 돌려주지 않은 개수. */
  omitted: number;
  /** 읽지 못했거나 끝까지 읽지 못한 목록. 비어 있지 않으면 결과가 불완전하다. */
  failedLists: { listId: string; listName: string; error: string }[];
  /** 한국 시간으로 바꾸지 못해 범위 판단에서 빠진 태스크 수. */
  unconvertible: number;
}

export class DueTasksApi {
  constructor(private readonly lists: TaskListsApi, private readonly tasks: TasksApi) {}

  async listDue(opts: DueTasksOptions): Promise<DueTasksResult> {
    const { from, to } = opts;
    for (const [name, value] of [["from", from], ["to", to]] as const) {
      if (!isYmd(value)) throw new AppError("validation_error", `${name} must be YYYY-MM-DD (Korea date), got "${value}".`);
      toGraphUtc(value); // 13월, 2월 30일 같은 없는 날짜를 거른다
    }
    if (from > to) throw new AppError("validation_error", `from (${from}) must not be after to (${to}).`);
    const cap = opts.maxResults ?? DEFAULT_DUE_LIMIT;
    if (!Number.isInteger(cap) || cap < 1 || cap > MAX_DUE_LIMIT) {
      throw new AppError("validation_error", `maxResults must be an integer from 1 to ${MAX_DUE_LIMIT}.`);
    }

    const lists = (await this.lists.list({ maxResults: MAX_DUE_LIMIT, traceId: opts.traceId })).items;
    const found: DueTask[] = [];
    const failedLists: DueTasksResult["failedLists"] = [];
    let unconvertible = 0;

    await forEachLimited(lists, LIST_CONCURRENCY, async (list) => {
      try {
        const open = await this.tasks.listOpen(list.id, opts.traceId);
        for (const task of open.items) {
          if (task.status === "completed") continue; // 서버 필터가 안 먹은 경우에도 안전하게
          if (task.timeWarning) { unconvertible++; continue; }
          if (!task.dueDate) continue;
          const overdue = task.dueDate < from;
          if (overdue ? !opts.includeOverdue : task.dueDate > to) continue;
          found.push({ ...task, listId: list.id, listName: list.displayName, overdue });
        }
        if (open.hasMore) {
          failedLists.push({ listId: list.id, listName: list.displayName, error: "Too many open tasks in this list; the rest were not read." });
        }
      } catch (err) {
        failedLists.push({ listId: list.id, listName: list.displayName, error: toAppError(err).message });
      }
    });

    found.sort(byDueThenTitle);
    const items = found.slice(0, cap);
    return { from, to, items, total: found.length, truncated: found.length > cap, omitted: found.length - items.length, failedLists, unconvertible };
  }

}

function byDueThenTitle(a: DueTask, b: DueTask): number {
  const ad = a.dueDateTime?.dateTime ?? "";
  const bd = b.dueDateTime?.dateTime ?? "";
  return ad < bd ? -1 : ad > bd ? 1 : a.title.localeCompare(b.title, "ko");
}

async function forEachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}
