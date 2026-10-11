// my-task original code (not derived from upstream).
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  logLevel: string | undefined;
  /** 벨루 주소(예: https://veloo.2joon.com). 계정 정보가 전송되므로 https만 허용한다. */
  baseUrl: string | undefined;
  username: string | undefined;
  password: string | undefined;
  /** 세션 쿠키를 저장하는 파일(홈 아래, 폴더 700, 파일 600). */
  sessionPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dir = env.VELOO_MCP_DIR || join(homedir(), ".config", "my-task-veloo-mcp");
  return {
    logLevel: env.LOG_LEVEL,
    baseUrl: env.VELOO_BASE_URL || undefined,
    username: env.VELOO_USERNAME || undefined,
    password: env.VELOO_PASSWORD || undefined,
    sessionPath: join(dir, "session.json"),
  };
}
