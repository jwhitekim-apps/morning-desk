// my-task original code (not derived from upstream).
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadConfig as folioConfig } from "@morning-desk/folio";
import { githubStatus, loadConfig as githubConfig } from "@morning-desk/github";
import { gmailAuth, loadConfig as gmailConfig } from "@morning-desk/gmail";
import { kakaoStatus, loadConfig as kakaoConfig } from "@morning-desk/kakao";
import { loadConfig as todoConfig, todoAuth } from "@morning-desk/microsoft-todo";
import { createLogger, SourceError } from "@morning-desk/shared";
import { loadConfig } from "./config";
import { loadEnvFile } from "./env";
import { MemoryStore } from "./memory";
import { migrateTokens } from "./migrate";
import { LlmClient } from "./model/client";
import { createModules } from "./modules";
import { run } from "./run";
import { VERSION } from "./version";

export const HELP = `morning-desk ${VERSION}

Usage:
  morning-desk run [--dry-run] [--force]   Build today's briefing and send it
                                           --dry-run: read and ask the model, but send, add and record nothing; print the briefing
                                           --force:   send again even if today's briefing was already sent
  morning-desk login <todo|gmail>          Sign in (To Do: device code, Gmail: browser). Run it yourself in a terminal
  morning-desk logout <todo|gmail>         Remove the saved sign-in from .env.local
  morning-desk auth-status                 Show which sources are signed in and configured (never prints values)
  morning-desk migrate-tokens [--dry-run]  Move old token files (~/.config/...) into the root .env.local
                                           --dry-run: only list what would move (key names, no values)
  morning-desk --version                   Print version
`;

/** 로그인이 있는 소스. 카카오·GitHub·폴리오는 `.env.local`의 값으로만 설정한다. */
const LOGIN_SOURCES = ["todo", "gmail"] as const;
type LoginSource = (typeof LOGIN_SOURCES)[number];

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
  env: NodeJS.ProcessEnv;
  repoRoot: string;
}

const yes = (b: boolean) => (b ? "있음" : "없음");

/** 소스별 로그인·설정 상태. 값(토큰, 키, 주소, 저장소 이름)은 출력하지 않고 있음/없음과 개수만 쓴다. */
export async function authStatus(env: NodeJS.ProcessEnv): Promise<string[]> {
  const lines: string[] = [];
  const todo = todoConfig(env);
  try {
    const who = await todoAuth.whoami(todo);
    lines.push(`To Do: ${who ? `로그인됨 (${who.username})` : "로그인 필요 (morning-desk login todo)"}`);
  } catch (err) {
    lines.push(`To Do: 확인 실패 (${err instanceof SourceError ? err.code : "오류"})`);
  }
  const gmail = gmailConfig(env);
  try {
    const s = await gmailAuth.status(gmail);
    lines.push(`Gmail: ${s.signedIn ? "로그인됨 (읽기 전용)" : "로그인 필요 (morning-desk login gmail)"}, OAuth 클라이언트 ${yes(Boolean(gmail.clientId && gmail.clientSecret))}`);
  } catch (err) {
    lines.push(`Gmail: 확인 실패 (${err instanceof SourceError ? err.code : "오류"})`);
  }
  try {
    const k = await kakaoStatus(kakaoConfig(env));
    lines.push(`카카오: REST API 키 ${yes(k.restApiKey)}, 클라이언트 시크릿 ${yes(k.clientSecret)}, 리프레시 토큰 ${yes(k.refreshToken)}`);
  } catch (err) {
    lines.push(`카카오: 확인 실패 (${err instanceof SourceError ? err.code : "오류"})`);
  }
  const gh = githubStatus(githubConfig(env));
  lines.push(`GitHub: 검색 토큰 ${yes(gh.searchToken)}, 알림 토큰 ${yes(gh.notificationsToken)}, 저장소 제한 ${gh.repoFilter.length}개`);
  const folio = folioConfig(env);
  lines.push(`폴리오: 주소 ${yes(Boolean(folio.url))}, 키 ${yes(Boolean(folio.key))}`);
  return lines;
}

/** 명령 하나를 실행하고 종료 코드를 돌려준다(0 정상, 1 실패, 2 사용법 오류, 3 오늘 이미 보냄). */
export async function runCli(args: readonly string[], io: CliIo): Promise<number> {
  if (args.includes("--version")) return io.out(`${VERSION}\n`), 0;
  if (args.length === 0 || args.includes("--help")) return io.out(HELP), 0;
  const cmd = args[0];
  const envPath = join(io.repoRoot, ".env.local");

  if (cmd === "migrate-tokens") {
    const result = await migrateTokens({ envPath, home: homedir(), dryRun: args.includes("--dry-run") });
    io.out(`${result.lines.join("\n")}\n`);
    return result.ok ? 0 : 1;
  }

  // 여기부터는 `.env.local`을 읽은 환경을 쓴다. 이미 있는 환경 변수는 덮어쓰지 않는다.
  loadEnvFile(envPath, io.env);
  const env: NodeJS.ProcessEnv = { ...io.env, MY_TASK_ENV_FILE: io.env.MY_TASK_ENV_FILE || envPath };

  if (cmd === "login" || cmd === "logout") {
    const source = args[1];
    if (!LOGIN_SOURCES.includes(source as LoginSource)) {
      io.err(`"${cmd}" needs a source: ${LOGIN_SOURCES.join(" or ")}.\n\n${HELP}`);
      return 2;
    }
    if (cmd === "logout") {
      if (source === "todo") await todoAuth.logout(todoConfig(env));
      else await gmailAuth.logout(gmailConfig(env));
      io.out(`Signed out of ${source} (its token line was removed from .env.local).\n`);
      return 0;
    }
    if (source === "todo") {
      const r = await todoAuth.login(todoConfig(env), (info) => io.out(`\n${info.message}\n\n`));
      io.out(`Signed in to To Do as ${r.username ?? "an unknown account"}.\n`);
    } else {
      await gmailAuth.login(gmailConfig(env), (url) => {
        io.err(`Open this address in your browser and approve read-only Gmail access:\n\n${url}\n\n`);
        if (process.platform === "darwin") execFile("open", [url], () => undefined);
      });
      io.out("Signed in to Gmail. Refresh token saved to .env.local (owner-only permissions).\n");
    }
    return 0;
  }

  if (cmd === "auth-status") {
    io.out(`${(await authStatus(env)).join("\n")}\n`);
    return 0;
  }

  if (cmd === "run") {
    const config = loadConfig(env, io.repoRoot);
    const logger = createLogger(config.logLevel);
    const dryRun = args.includes("--dry-run");
    const configured = Boolean(config.llm.baseUrl && config.llm.apiKey);
    const result = await run(
      { sources: createModules(env, io.repoRoot, logger), model: configured ? new LlmClient(config.llm, logger) : null, memory: new MemoryStore(config.memoryPath), logger },
      {
        dryRun,
        force: args.includes("--force"),
        createTasks: config.createTasks,
        maxCreates: config.maxCreates,
        listName: config.listName,
        collect: { enabled: config.sources, githubNotifications: config.githubNotifications, mailQuery: config.mailQuery },
      },
    );
    if (result.status === "already-sent") {
      io.out("오늘 브리핑은 이미 보냈어요. 다시 보내려면 --force를 붙이세요.\n");
      return 3;
    }
    if (dryRun) {
      // 드라이런은 만들어질 브리핑을 화면에 보여 준다(보내지 않는다). 실제 실행은 내용을 출력하지 않고 건수만 알린다.
      result.messages.forEach((m, i) => io.out(`--- ${i + 1}/${result.messages.length} (${m.length}자) ---\n${m}\n`));
      const planned = result.plan?.toCreate ?? [];
      if (planned.length > 0) io.out(`\n추가 예정 태스크 ${planned.length}건:\n${planned.map((t) => `- ${t.title} (마감 ${t.due ?? "없음"})`).join("\n")}\n`);
      io.out(`\n(드라이런: 카톡 전송, To Do 추가, 기록 저장을 하지 않았어요)\n`);
    } else {
      io.out(`브리핑 ${result.delivery?.sent ?? 0}통을 보냈어요. 추가한 태스크 ${result.writes?.created.length ?? 0}건.\n`);
    }
    return 0;
  }

  io.err(`Unknown command "${cmd}".\n\n${HELP}`);
  return 2;
}
