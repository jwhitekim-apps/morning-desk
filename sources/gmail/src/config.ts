// my-task original code (not derived from upstream).
import { resolveEnvFilePath } from "@morning-desk/shared";

export interface GmailConfig {
  logLevel: string | undefined;
  /** 갱신 토큰을 두는 루트 `.env.local` (`MY_TASK_ENV_FILE`). */
  envFilePath: string;
  clientId: string | undefined;
  clientSecret: string | undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GmailConfig {
  return {
    logLevel: env.LOG_LEVEL,
    envFilePath: resolveEnvFilePath(env),
    clientId: env.GMAIL_CLIENT_ID || undefined,
    clientSecret: env.GMAIL_CLIENT_SECRET || undefined,
  };
}
