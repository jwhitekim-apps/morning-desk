// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
import { randomUUID } from "node:crypto";

/** Injectable id generator — used for correlation/trace ids and the per-call `client-request-id`. */
export interface IdGenerator {
  uuid(): string;
}

export const cryptoIds: IdGenerator = { uuid: () => randomUUID() };
