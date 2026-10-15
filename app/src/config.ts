// my-task original code (not derived from upstream).
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { LlmConfig } from "./model/client";

export interface AppConfig {
  logLevel: string | undefined;
  repoRoot: string;
  llm: LlmConfig;
  /** 기록 파일(어제 기록, 처리한 소스, 마지막 전송일). 폴더 700, 파일 600. */
  memoryPath: string;
  /** To Do에 태스크를 실제로 추가한다. 기본은 꺼짐(병행 운영의 비교 단계). */
  createTasks: boolean;
  maxCreates: number;
  listName: string | undefined;
  sources: { gmail: boolean; github: boolean; folio: boolean };
  githubNotifications: boolean;
  mailQuery: string | undefined;
}

/** 실행 파일(`app/dist/index.js`)이 있는 `app/` 폴더의 상위(저장소 루트). */
export function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot: string = defaultRepoRoot()): AppConfig {
  const enabled = (env.ASSISTANT_SOURCES ?? "gmail,github,folio").split(",").map((x) => x.trim().toLowerCase());
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  return {
    logLevel: env.LOG_LEVEL,
    repoRoot,
    llm: {
      baseUrl: env.LOCAL_LLM_BASE_URL || undefined,
      apiKey: env.LOCAL_LLM_API_KEY || undefined,
      model: env.LOCAL_LLM_MODEL || "qwen3.6:35b-a3b",
      // 모델은 쓸 때만 메모리에 올라오므로 첫 호출을 넉넉히 기다린다. 값은 스파이크(작업 2.1)의 측정으로 다시 정한다.
      firstCallTimeoutMs: num(env.LOCAL_LLM_FIRST_TIMEOUT_MS, 300_000),
      timeoutMs: num(env.LOCAL_LLM_TIMEOUT_MS, 120_000),
      allowPlaintext: env.LLM_ALLOW_PLAINTEXT === "1",
    },
    memoryPath: join(env.AGENT_DIR || join(homedir(), ".config", "my-task-agent"), "memory.json"),
    createTasks: env.ASSISTANT_CREATE_TASKS === "1",
    maxCreates: num(env.ASSISTANT_MAX_CREATES, 10),
    listName: env.TODO_LIST_NAME || undefined,
    sources: { gmail: enabled.includes("gmail"), github: enabled.includes("github"), folio: enabled.includes("folio") },
    githubNotifications: Boolean(env.GITHUB_MCP_NOTIFICATIONS_TOKEN),
    mailQuery: env.MAIL_QUERY || undefined,
  };
}
