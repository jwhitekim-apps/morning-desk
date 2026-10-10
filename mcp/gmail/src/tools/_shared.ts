// my-task original code (not derived from upstream).
import type { z } from "zod";
import { AppError, toAppError } from "../errors";
import type { TokenProvider } from "../auth/oauth";
import type { GmailApi } from "../gmail/api";
import type { Logger } from "../logger";

/**
 * 위험 등급은 두 가지뿐이다: 메일함을 읽는 `read`, 로그인을 다루는 `auth`.
 * 쓰기 등급을 타입에서 아예 없애서, 쓰기 도구는 만들려고 해도 타입 검사에서 막힌다.
 */
export type RiskClass = "read" | "auth";

/** 도구가 쓰는 의존성. 실제 서버와 테스트가 같은 모양으로 채운다. */
export interface ToolContext {
  logger: Logger;
  auth: Pick<TokenProvider, "status" | "getAccessToken">;
  gmail: GmailApi;
}

export interface ToolDef {
  name: string;
  description: string;
  risk: RiskClass;
  /** zod 원시 모양 — `server.tool()`에 그대로 넘긴다. */
  inputShape: z.ZodRawShape;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

/** 입력 스키마에 맞춰 핸들러 타입을 검사한 뒤 지운다. */
export function defineTool<S extends z.ZodRawShape>(def: {
  name: string;
  description: string;
  risk: RiskClass;
  input: S;
  handler: (args: z.infer<z.ZodObject<S>>, ctx: ToolContext) => Promise<unknown>;
}): ToolDef {
  return { name: def.name, description: def.description, risk: def.risk, inputShape: def.input, handler: def.handler as ToolDef["handler"] };
}

const TEXT = "text" as const;

export function okResult(data: unknown) {
  return { content: [{ type: TEXT, text: JSON.stringify(data, null, 2) }] };
}

export function errorResult(err: unknown) {
  const appError = err instanceof AppError ? err : toAppError(err);
  return { content: [{ type: TEXT, text: JSON.stringify({ error: appError.toJSON() }, null, 2) }], isError: true as const };
}
