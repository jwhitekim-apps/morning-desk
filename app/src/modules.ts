// my-task original code (not derived from upstream).
import { join } from "node:path";
import { createFolioSource, loadConfig as folioConfig, type FolioSource } from "@morning-desk/folio";
import { createGithubSource, loadConfig as githubConfig, type GithubSource } from "@morning-desk/github";
import { createGmailSource, loadConfig as gmailConfig, type GmailSource } from "@morning-desk/gmail";
import { createKakaoSource, loadConfig as kakaoConfig, type KakaoSource } from "@morning-desk/kakao";
import { createTodoSource, loadConfig as todoConfig, type TodoSource } from "@morning-desk/microsoft-todo";
import type { Logger } from "@morning-desk/shared";
import { AppError } from "./errors";

/**
 * 하루 실행이 받는 소스 모듈. 앱이 할 수 있는 일은 이 객체들의 함수가 전부다(위임 정책).
 * 각 모듈의 허용 목록은 그 모듈의 `test/allowlist.test.ts`가 고정한다. 로그인 함수는 여기에 없다(사람이 실행하는 명령 전용).
 */
export interface SourceModules {
  todo: TodoSource;
  gmail: GmailSource;
  github: GithubSource;
  folio: FolioSource;
  kakao: KakaoSource;
}

/** 소스 호출 하나의 제한 시간(예전 MCP 호출과 같다). */
export const SOURCE_TIMEOUT_MS = 120_000;

/** 객체의 모든 함수 호출에 제한 시간을 건다. 넘으면 `timeout`으로 끝낸다(호출 자체를 멈추지는 못한다). */
export function withTimeouts<T extends object>(source: T, ms: number = SOURCE_TIMEOUT_MS): T {
  const out: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(source)) {
    out[name] = (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new AppError("timeout", `${name} did not finish within ${Math.round(ms / 1000)}s.`)), ms);
        Promise.resolve((fn as (...a: unknown[]) => unknown)(...args)).then(
          (v) => { clearTimeout(timer); resolve(v); },
          (e: unknown) => { clearTimeout(timer); reject(e); },
        );
      });
  }
  return out as T;
}

/**
 * `.env.local`을 읽은 환경에서 소스마다 자기 설정만 만들어 모듈을 만든다.
 * 토큰을 고쳐 쓰는 파일은 저장소 루트의 `.env.local`(`MY_TASK_ENV_FILE`이 있으면 그것)이다.
 */
export function createModules(env: NodeJS.ProcessEnv, repoRoot: string, logger: Logger): SourceModules {
  const withFile: NodeJS.ProcessEnv = { ...env, MY_TASK_ENV_FILE: env.MY_TASK_ENV_FILE || join(repoRoot, ".env.local") };
  return {
    todo: withTimeouts(createTodoSource(todoConfig(withFile))),
    gmail: withTimeouts(createGmailSource(gmailConfig(withFile), { logger: logger.child({ source: "gmail" }) })),
    github: withTimeouts(createGithubSource(githubConfig(withFile), { logger: logger.child({ source: "github" }) })),
    folio: withTimeouts(createFolioSource(folioConfig(withFile), { logger: logger.child({ source: "folio" }) })),
    kakao: withTimeouts(createKakaoSource(kakaoConfig(withFile), { logger: logger.child({ source: "kakao" }) })),
  };
}
