// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: removed the host-timezone default and toGraphDateTime; date-time input defaults to Korea time (lib/kst.ts).
import { z } from "zod";
import { KST } from "./kst";

/** Graph `dateTimeTimeZone` object as stored/returned by the API. */
export const DateTimeTimeZone = z.object({
  dateTime: z.string(),
  timeZone: z.string(),
});
export type DateTimeTimeZone = z.infer<typeof DateTimeTimeZone>;

/**
 * Tool-facing date-time input. Korea Standard Time is the default everywhere (see lib/kst.ts):
 * a date alone means that day in Korea, a date-time without an offset is Korea time.
 */
export const DateTimeInput = z.union([
  z
    .string()
    .describe(
      "ISO-8601 date or date-time. A date alone (2026-10-13) means that day in Korea Standard Time; a date-time without an offset (2026-10-13T15:00) is Korea time.",
    ),
  z.object({
    dateTime: z.string().describe("ISO-8601 date-time without offset, e.g. 2026-10-13T15:00:00"),
    timeZone: z.string().default(KST).describe("IANA time zone name; defaults to Asia/Seoul"),
  }),
]);
export type DateTimeInput = z.infer<typeof DateTimeInput>;

export const Importance = z.enum(["low", "normal", "high"]);
export type Importance = z.infer<typeof Importance>;

export const TaskStatus = z.enum(["notStarted", "inProgress", "completed", "waitingOnOthers", "deferred"]);
export type TaskStatus = z.infer<typeof TaskStatus>;
