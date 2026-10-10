// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: destructive, edit and management tools removed (read + create only); list_tasks_due added.
import { z } from "zod";
import { DateTimeInput, Importance, TaskStatus } from "../lib/schema";
import { DEFAULT_DUE_LIMIT, MAX_DUE_LIMIT } from "../todo/due";
import { defineTool, withIdempotency } from "./_shared";

export const taskTools = [
  defineTool({
    name: "list_tasks",
    description: "List tasks in a To Do list. Optionally filter by status and expand checklist items / linked resources inline.",
    risk: "read",
    input: {
      listId: z.string(),
      status: z.enum(["all", "notStarted", "inProgress", "completed"]).optional().describe("Filter by status; default 'all'"),
      includeChecklist: z.boolean().optional(),
      includeLinkedResources: z.boolean().optional(),
      cursor: z.string().optional(),
      maxResults: z.number().int().min(1).max(1000).optional(),
    },
    handler: (args, ctx) =>
      ctx.tasks.list(args.listId, {
        status: args.status,
        includeChecklist: args.includeChecklist,
        includeLinkedResources: args.includeLinkedResources,
        cursor: args.cursor,
        maxResults: args.maxResults,
        traceId: ctx.ids.uuid(),
      }),
  }),

  defineTool({
    name: "list_tasks_due",
    description:
      "List open tasks from ALL lists whose due date (Korea time) falls in [from, to], sorted by due date, each with its list name. " +
      "Optionally include overdue open tasks (due before `from`). Completed tasks and tasks without a due date are never returned. " +
      "If `failedLists` is non-empty the result is incomplete.",
    risk: "read",
    input: {
      from: z.string().describe("Start date, YYYY-MM-DD (Korea time)"),
      to: z.string().describe("End date, YYYY-MM-DD (Korea time), inclusive"),
      includeOverdue: z.boolean().optional().describe("Also return open tasks due before `from`, marked overdue: true"),
      maxResults: z.number().int().min(1).max(MAX_DUE_LIMIT).optional().describe(`Cap on returned tasks (default ${DEFAULT_DUE_LIMIT})`),
    },
    handler: (args, ctx) =>
      ctx.due.listDue({ from: args.from, to: args.to, includeOverdue: args.includeOverdue, maxResults: args.maxResults, traceId: ctx.ids.uuid() }),
  }),

  defineTool({
    name: "get_task",
    description: "Get a single To Do task by id.",
    risk: "read",
    input: {
      listId: z.string(),
      taskId: z.string(),
      includeChecklist: z.boolean().optional(),
      includeLinkedResources: z.boolean().optional(),
    },
    handler: (args, ctx) =>
      ctx.tasks.get(args.listId, args.taskId, {
        includeChecklist: args.includeChecklist,
        includeLinkedResources: args.includeLinkedResources,
        traceId: ctx.ids.uuid(),
      }),
  }),

  defineTool({
    name: "create_task",
    description:
      "Create a new task in a To Do list. If an open task with the same title (trimmed, case-insensitive) and the same due date (Korea time) " +
      "already exists in that list, nothing is created and the existing task is returned with alreadyExisted: true.",
    risk: "write",
    input: {
      listId: z.string(),
      title: z.string().min(1),
      body: z.string().optional().describe("Plain-text note/body"),
      dueDateTime: DateTimeInput.optional().describe("Due date-time: YYYY-MM-DD or ISO-8601 string (no zone = Korea time) or { dateTime, timeZone }"),
      reminderDateTime: DateTimeInput.optional(),
      importance: Importance.optional(),
      status: TaskStatus.optional(),
      categories: z.array(z.string()).optional(),
    },
    handler: (args, ctx) =>
      withIdempotency(ctx, "create_task", args, () =>
        ctx.tasks.createUnique(
          {
            listId: args.listId,
            title: args.title,
            body: args.body,
            dueDateTime: args.dueDateTime,
            reminderDateTime: args.reminderDateTime,
            importance: args.importance,
            status: args.status,
            categories: args.categories,
          },
          ctx.ids.uuid(),
        ),
      ),
  }),
];
