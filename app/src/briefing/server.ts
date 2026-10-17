// my-task original code (not derived from upstream).
import type { ServerChecks } from "@morning-desk/server";

/** 집 서버 점검 결과를 브리핑용으로 줄인 것. 이상이 있는 대상의 이름과 상태 낱말만 담는다. */
export interface ServerStatus {
  state: "ok" | "issues" | "skipped" | "failed";
  problems: string[];
}

const WORD: Record<string, string> = { degraded: "저하", down: "중단", unknown: "점검 불가" };

function codeOf(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unexpected";
}

/**
 * 서버 상태를 읽는다. 부르는 함수는 `checkServices`와 `checkLlm`뿐이다
 * (`summarizeDockerLogs`는 로그가 모델·카톡으로 흐를 수 있어 부르지 않는다).
 * 로그, 주소, 키, 원문 오류 메시지는 결과에 넣지 않는다.
 */
export async function readServerStatus(server: ServerChecks): Promise<ServerStatus> {
  const [svc, llm] = await Promise.allSettled([server.checkServices(), server.checkLlm()]);

  if (svc.status === "rejected") {
    const code = codeOf(svc.reason);
    if (code === "config_missing") return { state: "skipped", problems: [] };
    return { state: "failed", problems: [`서버 점검 실패 (${code})`] };
  }

  const problems: string[] = [];
  for (const s of [...svc.value.services, ...svc.value.containers]) {
    if (s.status !== "ok") problems.push(`${s.name} ${WORD[s.status] ?? "점검 불가"}`);
  }
  if (llm.status === "fulfilled") {
    if (llm.value.status !== "ok") problems.push(`${llm.value.name} ${WORD[llm.value.status] ?? "점검 불가"}`);
  } else {
    const code = codeOf(llm.reason);
    // LLM 대상이 설정에 없으면 그 점검만 건너뛴다.
    if (code !== "config_missing") problems.push(`LLM 점검 실패 (${code})`);
  }
  return problems.length > 0 ? { state: "issues", problems } : { state: "ok", problems: [] };
}
