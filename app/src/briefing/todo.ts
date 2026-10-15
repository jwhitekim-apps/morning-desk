// my-task original code (not derived from upstream).
import { z } from "zod";
import { AppError } from "../errors";
import type { ToolCaller } from "../mcp/pool";
import { classifyOpenTasks, UPCOMING_DAYS, type ReportInput } from "./report";

/** 한국 시간 기준 오늘 날짜(YYYY-MM-DD). */
export function kstToday(now: Date): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

const addDays = (ymd: string, days: number): string => {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** `list_tasks_due`가 돌려주는 모양에서 쓰는 부분만 확인한다. 어긋나면 조용히 해석하지 않고 오류로 올린다. */
const DueResult = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      body: z.object({ content: z.string() }).partial().optional(),
    }).passthrough(),
  ),
  truncated: z.boolean().optional(),
  omitted: z.number().optional(),
  failedLists: z.array(z.object({ listName: z.string() }).passthrough()).optional(),
  unconvertible: z.number().optional(),
});

export interface TodoSlice {
  tasksToday: ReportInput["tasksToday"];
  upcoming: NonNullable<ReportInput["upcoming"]>;
  overdue: NonNullable<ReportInput["overdue"]>;
  /** 사용자에게 알릴 참고 문장(잘림, 읽지 못한 목록, 한국 시간으로 못 바꾼 태스크). */
  notes: string[];
  /** 일부 목록을 읽지 못한 경우 실패 구역에 올릴 문장. */
  failures: string[];
  /** 모델과 쓰기 규칙이 "이미 To Do에 있는 일"을 알 수 있도록 읽은 태스크 전체(이름과 마감). */
  existing: { name: string; deadline: string }[];
}

/** To Do에서 오늘·임박·밀린 일을 모은다. 모델은 쓰지 않는다. To Do 자체를 못 읽으면 예외가 그대로 올라간다. */
export async function collectTodo(caller: ToolCaller, now: Date): Promise<TodoSlice> {
  const today = kstToday(now);
  const raw = await caller.call("todo", "list_tasks_due", { from: today, to: addDays(today, UPCOMING_DAYS), includeOverdue: true, maxResults: 200 });
  const parsed = DueResult.safeParse(raw);
  if (!parsed.success) throw new AppError("tool_error", "To Do's due-task answer has an unexpected shape.", { toolCode: "contract_changed" });
  const due = parsed.data;

  const tasks = due.items.map((t) => ({ name: t.title, memo: t.body?.content ?? "", deadline: t.dueDate, done: false }));
  const c = classifyOpenTasks(tasks, today);

  const notes: string[] = [];
  if (due.truncated) notes.push(`마감 일정이 많아 일부만 표시했어요(${due.omitted ?? 0}건 더 있음).`);
  if ((due.unconvertible ?? 0) > 0) notes.push(`시간대를 읽지 못한 태스크 ${due.unconvertible}건은 빠졌어요.`);
  const failures = (due.failedLists ?? []).map((l) => `To Do 목록 '${l.listName}' 읽지 못함`);

  return { tasksToday: c.today, upcoming: c.upcoming, overdue: c.overdue, notes, failures, existing: tasks.map((t) => ({ name: t.name, deadline: t.deadline })) };
}
