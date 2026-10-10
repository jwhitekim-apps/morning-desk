// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: destructive, edit and management tools removed (read + create only).
import { authTools } from "./auth-tools";
import { listTools } from "./list-tools";
import { taskTools } from "./task-tools";
import type { ToolDef } from "./_shared";

/** Single source of truth for the tool surface. `server.ts` filters this by risk class. */
export const allTools: ToolDef[] = [...authTools, ...listTools, ...taskTools];
