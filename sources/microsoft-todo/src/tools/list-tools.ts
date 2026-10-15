// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: destructive, edit and management tools removed (read + create only).
import { z } from "zod";
import { defineTool } from "./_shared";

export const listTools = [
  defineTool({
    name: "list_task_lists",
    description: "List all Microsoft To Do task lists for the signed-in user.",
    risk: "read",
    input: {
      cursor: z.string().optional().describe("Opaque pagination cursor returned by a previous call"),
      maxResults: z.number().int().min(1).max(1000).optional().describe("Soft cap on items (page-granular)"),
    },
    handler: (args, ctx) => ctx.lists.list({ cursor: args.cursor, maxResults: args.maxResults, traceId: ctx.ids.uuid() }),
  }),
];
