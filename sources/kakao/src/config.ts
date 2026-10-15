// my-task original code (not derived from upstream).
import { resolveEnvFilePath } from "@morning-desk/shared";

export interface KakaoConfig {
  logLevel: string | undefined;
  /** 리프레시 토큰을 두는 루트 `.env.local` (`MY_TASK_ENV_FILE`). */
  envFilePath: string;
  /** 카카오 개발자 앱의 REST API 키(= OAuth client_id). */
  restApiKey: string | undefined;
  /** 클라이언트 시크릿을 켠 앱이면 갱신에 필요하다. */
  clientSecret: string | undefined;
  /** 말풍선을 눌렀을 때 열 주소. 카카오 텍스트 템플릿이 링크를 요구해서 필요하다. */
  linkUrl: string | undefined;
  /** 켜져 있으면 모든 전송이 드라이런이 된다(앱이 끌 수 없다). */
  dryRunAll: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KakaoConfig {
  return {
    logLevel: env.LOG_LEVEL,
    envFilePath: resolveEnvFilePath(env),
    restApiKey: env.KAKAO_REST_API_KEY || undefined,
    clientSecret: env.KAKAO_CLIENT_SECRET || undefined,
    linkUrl: env.KAKAO_LINK_URL || undefined,
    dryRunAll: ["1", "true"].includes((env.KAKAO_DRY_RUN ?? "").toLowerCase()),
  };
}
