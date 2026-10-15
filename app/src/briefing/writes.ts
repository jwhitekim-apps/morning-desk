// my-task original code (not derived from upstream).
import type { TodoSource } from "@morning-desk/microsoft-todo";
import { SourceError } from "@morning-desk/shared";
import { AppError } from "../errors";
import type { AcceptedCandidate } from "../model/interpret";
import type { Sources } from "./sources";

export const DEFAULT_MAX_CREATES = 10;

export interface PlannedTask {
  title: string;
  due: string | null;
  /** 사람이 읽는 출처와 확인 필요 표시. 내부 표식이나 일련번호는 쓰지 않는다. */
  body: string;
  /** 이 태스크가 나온 소스 id(같은 스레드를 합쳤으면 여러 개). */
  sourceIds: string[];
  /** 모델이 낸 날짜를 근거가 없어 비웠다. */
  needsDateCheck: boolean;
}

export interface WritePlan {
  toCreate: PlannedTask[];
  /** To Do에 이미 있어서(이름·마감 같음) 만들지 않는 후보의 제목. */
  alreadyInTodo: string[];
  /** 상한을 넘어 추가하지 않는 후보의 제목. */
  overLimit: string[];
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

function sourceLine(c: AcceptedCandidate, sources: Sources): string {
  if (c.source === "mail") {
    const m = sources.mails.find((x) => x.id === c.sourceId);
    return `메일: ${m?.subject ?? "(제목 없음)"}`;
  }
  const g = sources.github.find((x) => x.id === c.sourceId);
  return `GitHub: ${g?.url ?? c.sourceId}`;
}

/**
 * 모델의 후보를 실제로 만들 태스크로 정한다. 최종 판단은 코드가 한다.
 * - To Do에 이름·마감이 같은 미완료 태스크가 있으면 만들지 않는다.
 * - 같은 메일 스레드에서 나온 마감 없는 일은 하나로 합친다.
 * - 실행당 상한을 넘는 후보는 만들지 않고 따로 알린다.
 */
export function planWrites(candidates: readonly AcceptedCandidate[], sources: Sources, existing: readonly { name: string; deadline: string }[], maxCreates = DEFAULT_MAX_CREATES): WritePlan {
  const have = new Set(existing.map((t) => `${norm(t.name)}\u0000${t.deadline}`));
  const alreadyInTodo: string[] = [];
  const planned: PlannedTask[] = [];
  const undatedByThread = new Map<string, PlannedTask>();
  const threadOf = (c: AcceptedCandidate) => (c.source === "mail" ? sources.mails.find((m) => m.id === c.sourceId)?.threadId : undefined);

  for (const c of candidates) {
    if (have.has(`${norm(c.title)}\u0000${c.due ?? ""}`)) {
      alreadyInTodo.push(c.title);
      continue;
    }
    const thread = threadOf(c);
    const line = sourceLine(c, sources);
    if (c.due === null && thread) {
      const merged = undatedByThread.get(thread);
      if (merged) {
        // 같은 스레드의 두 번째 이후 일은 첫 태스크 본문에 덧붙인다.
        merged.body = `${merged.body}\n함께 할 일: ${c.title}`;
        if (!merged.sourceIds.includes(c.sourceId)) merged.sourceIds.push(c.sourceId);
        continue;
      }
    }
    const task: PlannedTask = {
      title: c.title,
      due: c.due,
      body: [line, c.dueDropped ? "마감 확인 필요: 메일에 날짜가 분명하지 않아 비워 두었어요." : c.due === null ? "마감 없음: 날짜가 적혀 있지 않았어요." : ""].filter(Boolean).join("\n"),
      sourceIds: [c.sourceId],
      needsDateCheck: Boolean(c.dueDropped),
    };
    if (task.due === null && thread) undatedByThread.set(thread, task);
    planned.push(task);
    have.add(`${norm(c.title)}\u0000${c.due ?? ""}`); // 같은 실행 안의 중복도 막는다
  }

  return { toCreate: planned.slice(0, maxCreates), alreadyInTodo, overLimit: planned.slice(maxCreates).map((t) => t.title) };
}

/** 태스크를 넣을 목록: 설정한 이름이 있으면 그것, 없으면 기본 목록(`defaultList`). */
export async function findListId(todo: TodoSource, preferredName?: string): Promise<string> {
  const lists = (await todo.listTaskLists()).items;
  const chosen = (preferredName ? lists.find((l) => l.displayName === preferredName) : undefined) ?? lists.find((l) => l.wellknownListName === "defaultList");
  if (!chosen) throw new AppError("config_error", "Could not find the To Do list to add tasks to.");
  return chosen.id;
}

export interface WriteResult {
  created: { title: string; due: string | null; sourceIds: string[] }[];
  /** 서버가 이미 있다고 알려 준 것(목록 밖의 같은 태스크 등). */
  existed: string[];
  /** 만들다가 실패한 것과 이유 코드. */
  failed: { title: string; code: string }[];
}

/** 계획한 태스크를 추가한다. 한 건이 실패해도 나머지는 계속하고 실패를 돌려준다. */
export async function applyWrites(todo: TodoSource, plan: WritePlan, listId: string): Promise<WriteResult> {
  const result: WriteResult = { created: [], existed: [], failed: [] };
  for (const t of plan.toCreate) {
    try {
      const r = await todo.createTask({ listId, title: t.title, body: t.body, ...(t.due ? { dueDateTime: t.due } : {}) });
      if (r.alreadyExisted) result.existed.push(t.title);
      else result.created.push({ title: t.title, due: t.due, sourceIds: t.sourceIds });
    } catch (err) {
      result.failed.push({ title: t.title, code: err instanceof SourceError || err instanceof AppError ? err.code : "internal_error" });
    }
  }
  return result;
}
