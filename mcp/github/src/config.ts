// my-task original code (not derived from upstream).
export interface AppConfig {
  logLevel: string | undefined;
  /** 검색 도구용 토큰: 읽기 전용 fine-grained 토큰. `gh auth`의 넓은 토큰을 쓰지 않는다. */
  token: string | undefined;
  /** 알림 도구용 토큰: 클래식 토큰, 권한은 `notifications` 하나만(알림 API는 클래식 토큰만 지원). 없으면 알림 도구만 꺼진다. */
  notificationsToken: string | undefined;
  /** 포함할 저장소 패턴(`owner/repo`, `owner/*`). 비어 있으면 제한 없음. */
  repos: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    logLevel: env.LOG_LEVEL,
    token: env.GITHUB_MCP_TOKEN || undefined,
    notificationsToken: env.GITHUB_MCP_NOTIFICATIONS_TOKEN || undefined,
    repos: (env.GITHUB_MCP_REPOS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
