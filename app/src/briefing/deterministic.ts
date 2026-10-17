// my-task original code (not derived from upstream).
import type { TodoSource } from "@morning-desk/microsoft-todo";
import { describeFailure } from "./failures";
import { buildReport, type ReportInput } from "./report";
import { collectTodo, type TodoSlice } from "./todo";
import { pickTop } from "./top";

export const KAKAO_BUBBLE_LIMIT = 200;
export const MAX_BUBBLES = 8;

export interface BriefingResult {
  messages: string[];
  input: ReportInput;
}

export interface ComposeInput {
  now: Date;
  /** 읽은 To Do. 읽지 못했으면 null(그때는 실패 알림만 나간다). */
  todo: TodoSlice | null;
  failures?: string[];
  created?: ReportInput["created"];
  uncertain?: string[];
  notes?: string[];
  remark?: string[];
  sourceSections?: ReportInput["sourceSections"];
  disabledSources?: string[];
  server?: ReportInput["server"];
}

/** 모은 것을 구역으로 정리해 말풍선으로 만든다. To Do를 못 읽었으면 실패 구역만 담는다. */
export function compose(c: ComposeInput): BriefingResult {
  const top = c.todo ? pickTop(c.todo) : [];
  const shown = new Set(top.map((t) => t.name));
  const extras: Partial<ReportInput> = {
    ...(c.sourceSections ? { sourceSections: c.sourceSections } : {}),
    ...(c.disabledSources ? { disabledSources: c.disabledSources } : {}),
    ...(c.server ? { server: c.server } : {}),
  };
  // 먼저 할 일에 올린 것은 밀린 일·임박에서 되풀이하지 않는다(오늘 마감은 그대로 둔다).
  const input: ReportInput = c.todo
    ? {
        now: c.now,
        top,
        tasksToday: c.todo.tasksToday,
        upcoming: c.todo.upcoming.filter((t) => !shown.has(t.name)),
        overdue: c.todo.overdue.filter((t) => !shown.has(t.name)),
        failures: [...(c.failures ?? []), ...c.todo.failures],
        created: c.created ?? [],
        uncertain: c.uncertain ?? [],
        notes: [...(c.notes ?? []), ...c.todo.notes],
        remark: c.remark ?? [],
        ...extras,
      }
    : { now: c.now, tasksToday: [], created: [], uncertain: [], failures: c.failures ?? [], ...extras };
  return { messages: buildReport(input, KAKAO_BUBBLE_LIMIT, MAX_BUBBLES), input };
}

/** To Do를 읽어서 그 결과(또는 실패 문장)를 돌려준다. */
export async function readTodo(todo: TodoSource, now: Date): Promise<{ todo: TodoSlice | null; failure: string | null }> {
  try {
    return { todo: await collectTodo(todo, now), failure: null };
  } catch (err) {
    return { todo: null, failure: describeFailure("To Do", err) };
  }
}

/**
 * 모델 없이 To Do의 오늘·임박·밀린 일만으로 만든 기본 브리핑.
 * To Do를 읽지 못하면 브리핑 대신 실패 알림만 만든다(알림은 나가야 한다).
 */
export async function buildDeterministicBriefing(todoSource: TodoSource, now: Date, opts: { modelFailure?: string; failures?: string[] } = {}): Promise<BriefingResult> {
  // 실패 구역: 모델 실패, 읽지 못한 소스 순서로 위에서부터 적는다.
  const earlier = [...(opts.modelFailure ? [opts.modelFailure] : []), ...(opts.failures ?? [])];
  const { todo, failure } = await readTodo(todoSource, now);
  return compose({ now, todo, failures: failure ? [...earlier, failure] : earlier, notes: opts.modelFailure && todo ? ["모델 없이 만든 기본 브리핑이에요."] : [] });
}
