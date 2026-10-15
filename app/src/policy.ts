// my-task original code (not derived from upstream).
import { AppError } from "./errors";
import type { ServerName } from "./config";
import type { ToolCaller } from "./mcp/pool";

/**
 * 위임 정책: 에이전트가 부를 수 있는 도구는 이 목록이 전부다.
 * 읽기는 소스마다 필요한 것만, 쓰기는 To Do의 태스크 추가(`create_task`)와 카톡 나에게 보내기(`send_many_to_me`) 둘뿐이다.
 * 수정·완료·삭제 도구는 MCP 서버에 아예 없고, 여기서도 한 번 더 막는다.
 */
export const ALLOWED_CALLS: Readonly<Record<ServerName, readonly string[]>> = {
  todo: ["list_tasks_due", "list_task_lists", "list_tasks", "get_task", "create_task"],
  gmail: ["search_emails", "read_email"],
  github: ["list_review_requests", "list_assigned_items", "list_notifications"],
  folio: ["list_recent_papers", "search_papers"],
  kakao: ["send_many_to_me"],
};

/** 세상에 영향을 주는(쓰기) 호출 목록. 드라이런에서는 이 호출이 일어나지 않는다. */
export const WRITE_CALLS: readonly string[] = ["todo.create_task", "kakao.send_many_to_me"];

/** 허용 목록 밖의 호출을 막는 감싸개. */
export function guard(inner: ToolCaller): ToolCaller {
  return {
    async call(server, tool, args, opts) {
      if (!ALLOWED_CALLS[server]?.includes(tool)) {
        throw new AppError("config_error", `Tool ${server}.${tool} is not allowed for the assistant.`);
      }
      return inner.call(server, tool, args, opts);
    },
    tools: (server) => inner.tools(server),
    close: () => inner.close(),
  };
}
