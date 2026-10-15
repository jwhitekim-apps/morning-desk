// my-task original code (not derived from upstream).
import type { TodoSlice } from "./todo";

export const TOP_COUNT = 3;

/**
 * 오늘 먼저 할 일(최대 3개)을 규칙으로 고른다(모델을 쓰지 않는다).
 * 순서: 밀린 일(오래 밀린 것부터) → 오늘 마감 → 임박(가까운 것부터). 이유는 한 줄로 적는다.
 */
export function pickTop(todo: TodoSlice, count = TOP_COUNT): { name: string; reason: string }[] {
  const out: { name: string; reason: string }[] = [];
  const push = (name: string, reason: string) => { if (out.length < count && !out.some((t) => t.name === name)) out.push({ name, reason }); };
  for (const t of [...todo.overdue].sort((a, b) => (b.days ?? 0) - (a.days ?? 0))) push(t.name, t.days !== undefined ? `${t.days}일 밀림` : "마감 지남");
  for (const t of todo.tasksToday) push(t.name, "오늘 마감");
  for (const t of todo.upcoming) push(t.name, t.daysLeft !== undefined ? `${t.daysLeft}일 남음` : "곧 마감");
  return out;
}
