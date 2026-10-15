// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: reminders are sent as UTC computed from Korea time, due dates as a Korea-time date at midnight (Graph keeps only the date); responses show due/reminder/completed in Korea time (lib/kst.ts); list() can exclude completed tasks server-side; listOpen() and createUnique() (duplicate guard) added.
import { toAppError } from "../graph/errors";
import { collectPages, type Page } from "../graph/pagination";
import type { GraphClient } from "../graph/client";
import { fromGraph, KST, toGraphUtc, toKstGraph } from "../lib/kst";
import type { DateTimeInput, Importance, TaskStatus } from "../lib/schema";
import { ChecklistItemSchema, TaskSchema, type ChecklistItem, type Task } from "./types";

const PAGE_SIZE = 100;
/** 한 목록에서 읽는 미완료 태스크의 상한. 넘으면 `hasMore`로 알린다. */
const OPEN_TASKS_CAP = 2000;

export interface CreateTaskInput {
  listId: string;
  title: string;
  body?: string;
  dueDateTime?: DateTimeInput;
  reminderDateTime?: DateTimeInput;
  importance?: Importance;
  status?: TaskStatus;
  categories?: string[];
}

export interface UpdateTaskFields {
  title?: string;
  body?: string;
  dueDateTime?: DateTimeInput | null;
  reminderDateTime?: DateTimeInput | null;
  importance?: Importance;
  status?: TaskStatus;
  categories?: string[];
}

export interface ListTasksOptions {
  status?: "all" | "notStarted" | "inProgress" | "completed";
  /** `status`가 없거나 "all"일 때 완료된 태스크를 서버에서 거른다(`status ne 'completed'`). */
  excludeCompleted?: boolean;
  includeChecklist?: boolean;
  includeLinkedResources?: boolean;
  cursor?: string;
  maxResults?: number;
  traceId?: string;
}

export class TasksApi {
  constructor(private readonly graph: GraphClient, private readonly defaultMaxResults: number) {}

  async list(listId: string, opts: ListTasksOptions = {}): Promise<{ items: KstTask[]; hasMore: boolean; cursor?: string }> {
    const cap = opts.maxResults ?? this.defaultMaxResults;
    const query: Record<string, string | number> = { $top: PAGE_SIZE };
    const expand = expandParam(opts);
    if (expand) query.$expand = expand;
    if (opts.status && opts.status !== "all") query.$filter = `status eq '${opts.status}'`;
    else if (opts.excludeCompleted) query.$filter = "status ne 'completed'";

    const base = `/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
    const result = await collectPages<unknown>(
      () => this.graph.request<Page<unknown>>("GET", base, { query, traceId: opts.traceId }),
      (url) => this.graph.request<Page<unknown>>("GET", url, { traceId: opts.traceId }),
      cap,
      opts.cursor,
    );
    return { items: result.items.map((x) => toKstTask(TaskSchema.parse(x))), hasMore: result.hasMore, cursor: result.cursor };
  }

  async get(listId: string, taskId: string, opts: { includeChecklist?: boolean; includeLinkedResources?: boolean; traceId?: string } = {}): Promise<KstTask> {
    const expand = expandParam(opts);
    return toKstTask(TaskSchema.parse(
      await this.graph.request<unknown>("GET", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
        query: expand ? { $expand: expand } : undefined,
        traceId: opts.traceId,
      }),
    ));
  }

  async create(input: CreateTaskInput, traceId?: string): Promise<KstTask> {
    return toKstTask(TaskSchema.parse(
      await this.graph.request<unknown>("POST", `/me/todo/lists/${encodeURIComponent(input.listId)}/tasks`, { body: taskPayload(input), traceId }),
    ));
  }

  /** 목록의 미완료 태스크. 서버 필터를 쓰고, Graph가 필터를 400으로 거부하면 전부 받아 호출한 쪽이 거르게 한다. */
  async listOpen(listId: string, traceId?: string): Promise<{ items: KstTask[]; hasMore: boolean }> {
    try {
      return await this.list(listId, { excludeCompleted: true, maxResults: OPEN_TASKS_CAP, traceId });
    } catch (err) {
      if (toAppError(err).status !== 400) throw err;
      const all = await this.list(listId, { maxResults: OPEN_TASKS_CAP, traceId });
      return { items: all.items.filter((t) => t.status !== "completed"), hasMore: all.hasMore };
    }
  }

  /**
   * 같은 목록에 이름(앞뒤 공백 제거, 대소문자 무시)과 마감 날짜(한국)가 같은 미완료 태스크가 이미 있으면
   * 만들지 않고 그것을 돌려준다. 프로세스 밖 상태(Graph)를 보고 판단하므로 재시작해도 유효하다.
   */
  async createUnique(input: CreateTaskInput, traceId?: string): Promise<KstTask & { alreadyExisted: boolean }> {
    const wantedDue = input.dueDateTime === undefined ? undefined : fromGraph(toGraphUtc(input.dueDateTime)).date;
    const wantedTitle = normalizeTitle(input.title);
    const open = await this.listOpen(input.listId, traceId);
    const existing = open.items.find((t) => normalizeTitle(t.title) === wantedTitle && t.dueDate === wantedDue);
    if (existing) return { ...existing, alreadyExisted: true };
    return { ...(await this.create(input, traceId)), alreadyExisted: false };
  }

  async update(listId: string, taskId: string, fields: UpdateTaskFields, traceId?: string): Promise<KstTask> {
    return toKstTask(TaskSchema.parse(
      await this.graph.request<unknown>("PATCH", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
        body: taskPayload(fields),
        traceId,
      }),
    ));
  }

  complete(listId: string, taskId: string, traceId?: string): Promise<KstTask> {
    return this.update(listId, taskId, { status: "completed" }, traceId);
  }

  async remove(listId: string, taskId: string, traceId?: string): Promise<void> {
    await this.graph.request<void>("DELETE", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { traceId });
  }

  async listChecklist(listId: string, taskId: string, traceId?: string): Promise<ChecklistItem[]> {
    const res = await this.graph.request<Page<unknown>>(
      "GET",
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems`,
      { traceId },
    );
    return res.value.map((x) => ChecklistItemSchema.parse(x));
  }

  async addChecklistItem(listId: string, taskId: string, displayName: string, isChecked: boolean, traceId?: string): Promise<ChecklistItem> {
    return ChecklistItemSchema.parse(
      await this.graph.request<unknown>("POST", `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems`, {
        body: { displayName, isChecked },
        traceId,
      }),
    );
  }

  async updateChecklistItem(
    listId: string,
    taskId: string,
    itemId: string,
    patch: { displayName?: string; isChecked?: boolean },
    traceId?: string,
  ): Promise<ChecklistItem> {
    return ChecklistItemSchema.parse(
      await this.graph.request<unknown>(
        "PATCH",
        `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems/${encodeURIComponent(itemId)}`,
        { body: patch, traceId },
      ),
    );
  }

  async removeChecklistItem(listId: string, taskId: string, itemId: string, traceId?: string): Promise<void> {
    await this.graph.request<void>(
      "DELETE",
      `/me/todo/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/checklistItems/${encodeURIComponent(itemId)}`,
      { traceId },
    );
  }
}

const normalizeTitle = (title: string): string => title.trim().toLowerCase();

function expandParam(opts: { includeChecklist?: boolean; includeLinkedResources?: boolean }): string {
  return [opts.includeChecklist ? "checklistItems" : null, opts.includeLinkedResources ? "linkedResources" : null].filter(Boolean).join(",");
}

/** Build the Graph request body from create/update input — only touches keys that were provided. */
function taskPayload(input: CreateTaskInput | UpdateTaskFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if ("title" in input && input.title !== undefined) out.title = input.title;
  if (input.body !== undefined) out.body = { content: input.body, contentType: "text" };
  if (input.importance !== undefined) out.importance = input.importance;
  if (input.status !== undefined) out.status = input.status;
  if (input.categories !== undefined) out.categories = input.categories;
  if (input.dueDateTime !== undefined) out.dueDateTime = input.dueDateTime === null ? null : toGraphDueDate(input.dueDateTime);
  if (input.reminderDateTime !== undefined) {
    out.reminderDateTime = input.reminderDateTime === null ? null : toGraphUtc(input.reminderDateTime);
    out.isReminderOn = input.reminderDateTime !== null;
  }
  return out;
}

/**
 * 마감은 날짜만 저장된다: Graph는 보낸 시각을 버리고 "보낸 시간대 기준의 날짜"를 그 시간대 자정으로 저장한다(실측).
 * 그래서 한국 날짜를 구해 `Asia/Seoul` 자정으로 보낸다. UTC로 바꿔 보내면 한국 자정이 전날이 되어 하루 어긋난다.
 */
function toGraphDueDate(input: DateTimeInput): { dateTime: string; timeZone: string } {
  return { dateTime: `${fromGraph(toGraphUtc(input)).date}T00:00:00.0000000`, timeZone: KST };
}

/** 응답용 태스크: 한국 시간 기준 마감 날짜(`dueDate`)를 더하고, 마감·알림·완료 일시를 한국 시간으로 바꾼다. */
export type KstTask = Task & { dueDate?: string; timeWarning?: string };

/**
 * 모르는 시간대가 한 태스크에 있어도 목록 전체를 실패시키지 않는다. 그 태스크만 원본을 그대로 두고
 * `timeWarning`으로 알린다(조용히 넘기지 않는다).
 */
export function toKstTask(task: Task): KstTask {
  const out: KstTask = { ...task };
  try {
    if (task.dueDateTime) {
      out.dueDate = fromGraph(task.dueDateTime).date;
      out.dueDateTime = toKstGraph(task.dueDateTime);
    }
    if (task.reminderDateTime) out.reminderDateTime = toKstGraph(task.reminderDateTime);
    if (task.completedDateTime) out.completedDateTime = toKstGraph(task.completedDateTime);
  } catch (err) {
    return { ...task, timeWarning: `Could not convert date-times to Korea time: ${err instanceof Error ? err.message : String(err)}` };
  }
  return out;
}
