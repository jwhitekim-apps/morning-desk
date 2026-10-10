// my-task original code (not derived from upstream).
import type { z } from "zod";
import type { KakaoAuth } from "../auth/provider";
import { AppError, toAppError } from "../errors";
import type { KakaoApi } from "../kakao/api";
import type { Logger } from "../logger";

/**
 * 위험 등급은 `send`(나에게 보내기)와 `auth`(상태 확인)뿐이다. 읽기 등급이 없는 것은 카카오가 대화 읽기를 제공하지 않기 때문이다.
 */
export type RiskClass = "send" | "auth";

export interface ToolContext {
  logger: Logger;
  auth: Pick<KakaoAuth, "status">;
  kakao: KakaoApi;
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
