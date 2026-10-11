// my-task original code (not derived from upstream).
import { resolveEnvFilePath } from "./env-file";

export interface AppConfig {
  logLevel: string | undefined;
  /** 벨루 주소(예: https://veloo.2joon.com). 계정 정보가 전송되므로 https만 허용한다. */
  baseUrl: string | undefined;
  username: string | undefined;
  password: string | undefined;
  /** 세션 쿠키를 저장하는 루트 `.env.local` (`MY_TASK_ENV_FILE`). */
  envFilePath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    logLevel: env.LOG_LEVEL,
    baseUrl: env.VELOO_BASE_URL || undefined,
    username: env.VELOO_USERNAME || undefined,
    password: env.VELOO_PASSWORD || undefined,
    envFilePath: resolveEnvFilePath(env),
  };
}
