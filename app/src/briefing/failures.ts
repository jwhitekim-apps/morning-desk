// my-task original code (not derived from upstream).
import { AppError } from "../errors";

export type SourceLabel = "To Do" | "Gmail" | "GitHub" | "폴리오" | "모델" | "카카오";

/** MCP 서버가 돌려주는 오류 코드를 사람이 읽을 짧은 이유로 바꾼다. 서버의 설명문은 쓰지 않는다(내용이 섞일 수 있다). */
const REASONS: Record<string, string> = {
  auth_required: "로그인 필요",
  auth_expired: "로그인 만료",
  auth_failed: "인증 실패",
  permission_denied: "권한 부족",
  rate_limited: "요청 한도 초과",
  unavailable: "서버 일시 장애",
  config_error: "설정 누락",
  not_found: "찾을 수 없음",
  validation_error: "요청 오류",
  contract_changed: "응답 형식 변경",
  upstream_error: "응답 이상",
  table_not_found: "테이블 없음",
};

/** 실패 구역에 올릴 한 줄: `Gmail 로그인 만료`. 원인을 모르면 `오류`. */
export function describeFailure(source: SourceLabel, err: unknown): string {
  if (err instanceof AppError) {
    if (err.code === "timeout") return `${source} 시간 초과`;
    if (err.code === "server_unavailable") return `${source} 연결 실패`;
    if (err.code === "config_error") return `${source} 설정 누락`;
    if (err.code === "tool_error" && err.toolCode) return `${source} ${REASONS[err.toolCode] ?? "오류"}`;
  }
  return `${source} 오류`;
}
