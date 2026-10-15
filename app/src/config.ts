// my-task original code (not derived from upstream).
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppError } from "./errors";
import type { LlmConfig } from "./model/client";

export type ServerName = "todo" | "gmail" | "kakao" | "github" | "folio";

export interface ServerSpec {
  name: ServerName;
  /** 실행할 파일(빌드된 MCP 서버의 진입점). */
  entry: string;
  /** 이 서버에만 넘기는 환경 변수. 다른 서버의 비밀은 들어가지 않는다. */
  env: Record<string, string>;
}

export interface AppConfig {
  logLevel: string | undefined;
  repoRoot: string;
  servers: Record<ServerName, ServerSpec>;
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

/** 서버마다 필요한 환경 변수의 이름. 최소 권한: 여기 없는 변수는 자식 프로세스에 넘기지 않는다. */
const SERVER_ENV: Record<ServerName, { dir: string; keys: readonly string[] }> = {
  todo: { dir: "microsoft-todo", keys: ["MS_TODO_CLIENT_ID", "MS_TODO_AUTHORITY", "MS_TODO_MAX_RESULTS", "MS_TODO_READONLY", "MS_TODO_SCOPE_READONLY"] },
  gmail: { dir: "gmail", keys: ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET"] },
  // 토큰(`KAKAO_REFRESH_TOKEN` 등)은 넘기지 않는다. 서버가 `MY_TASK_ENV_FILE`에서 자기 키만 직접 읽고 고쳐 쓴다.
  kakao: { dir: "kakao", keys: ["KAKAO_REST_API_KEY", "KAKAO_CLIENT_SECRET", "KAKAO_LINK_URL", "KAKAO_DRY_RUN"] },
  github: { dir: "github", keys: ["GITHUB_MCP_TOKEN", "GITHUB_MCP_NOTIFICATIONS_TOKEN", "GITHUB_MCP_REPOS"] },
  folio: { dir: "folio", keys: ["FOLIO_SUPABASE_URL", "FOLIO_SUPABASE_KEY", "FOLIO_TABLE"] },
};

/** 모든 자식 프로세스에 공통으로 필요한 최소한의 변수. */
const BASE_KEYS = ["PATH", "HOME", "LANG", "TMPDIR"] as const;

/** 이 파일이 있는 `agent/` 폴더의 상위(저장소 루트). */
export function defaultRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, repoRoot: string = defaultRepoRoot()): AppConfig {
  const servers = {} as Record<ServerName, ServerSpec>;
  for (const [name, def] of Object.entries(SERVER_ENV) as [ServerName, (typeof SERVER_ENV)[ServerName]][]) {
    const childEnv: Record<string, string> = { MY_TASK_ENV_FILE: join(repoRoot, ".env.local") };
    for (const key of [...BASE_KEYS, ...def.keys]) {
      const value = env[key];
      if (value !== undefined) childEnv[key] = value;
    }
    servers[name] = { name, entry: join(repoRoot, "mcp", def.dir, "dist", "index.js"), env: childEnv };
  }
  const enabled = (env.ASSISTANT_SOURCES ?? "gmail,github,folio").split(",").map((x) => x.trim().toLowerCase());
  const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
  return {
    logLevel: env.LOG_LEVEL,
    repoRoot,
    servers,
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

export function requireServers(config: AppConfig, names: readonly ServerName[]): void {
  const missing = names.filter((n) => !config.servers[n]);
  if (missing.length > 0) throw new AppError("config_error", `Unknown server(s): ${missing.join(", ")}`);
}
