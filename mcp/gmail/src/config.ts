// my-task original code (not derived from upstream).
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  logLevel: string | undefined;
  /** 토큰과 OAuth 클라이언트 파일을 두는 폴더(홈 아래, 권한 700). */
  configDir: string;
  tokenPath: string;
  clientPath: string;
  /** 환경 변수로 준 OAuth 클라이언트. 없으면 `clientPath` 파일을 쓴다. */
  clientId: string | undefined;
  clientSecret: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configDir = env.GMAIL_MCP_DIR || join(homedir(), ".config", "my-task-gmail-mcp");
  return {
    logLevel: env.LOG_LEVEL,
    configDir,
    tokenPath: join(configDir, "token.json"),
    clientPath: join(configDir, "client.json"),
    clientId: env.GMAIL_CLIENT_ID || undefined,
    clientSecret: env.GMAIL_CLIENT_SECRET || undefined,
  };
}
