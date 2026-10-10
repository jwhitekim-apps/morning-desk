// my-task original code (not derived from upstream).
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppConfig {
  logLevel: string | undefined;
  /** 갱신 토큰 파일을 두는 폴더(홈 아래, 권한 700). */
  configDir: string;
  tokenPath: string;
  /** 카카오 개발자 앱의 REST API 키(= OAuth client_id). */
  restApiKey: string | undefined;
  /** 클라이언트 시크릿을 켠 앱이면 갱신에 필요하다. */
  clientSecret: string | undefined;
  /** 최초 시작 값. 토큰 파일이 있으면 파일이 우선한다. */
  refreshToken: string | undefined;
  /** 말풍선을 눌렀을 때 열 주소. 카카오 텍스트 템플릿이 링크를 요구해서 필요하다. */
  linkUrl: string | undefined;
  /** 켜져 있으면 모든 전송이 드라이런이 된다(호출 쪽이 끌 수 없다). */
  dryRunAll: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configDir = env.KAKAO_MCP_DIR || join(homedir(), ".config", "my-task-kakao-mcp");
  return {
    logLevel: env.LOG_LEVEL,
    configDir,
    tokenPath: join(configDir, "token.json"),
    restApiKey: env.KAKAO_REST_API_KEY || undefined,
    clientSecret: env.KAKAO_CLIENT_SECRET || undefined,
    refreshToken: env.KAKAO_REFRESH_TOKEN || undefined,
    linkUrl: env.KAKAO_LINK_URL || undefined,
    dryRunAll: ["1", "true"].includes((env.KAKAO_DRY_RUN ?? "").toLowerCase()),
  };
}
