// my-task original code (not derived from upstream).
import { serverTools } from "./server-tools";
import type { ToolDef } from "./_shared";

/** 도구 표면의 단일 출처. 도구를 더하려면 여기와 `test/registry.test.ts`의 허용 목록을 함께 의도적으로 고친다. */
export const allTools: ToolDef[] = [...serverTools];
