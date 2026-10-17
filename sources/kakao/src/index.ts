// my-task original code (not derived from upstream).
import type { Logger } from "@morning-desk/shared";
import { KakaoAuth, TokenStore, type FetchFn } from "./auth/provider";
import type { KakaoConfig } from "./config";
import { KakaoApi, type SendResult } from "./kakao/api";

export { loadConfig, type KakaoConfig } from "./config";
export { AppError as KakaoError, type ErrorCode as KakaoErrorCode } from "./errors";
export { countChars, MAX_BATCH, TEXT_LIMIT, type SendResult } from "./kakao/api";

/**
 * 앱이 카카오톡에 대해 할 수 있는 일의 전부: 로그인한 본인에게 보내기("나에게 보내기").
 * 받는 사람을 지정하는 인자가 없고, 친구에게 보내기와 대화 읽기는 없다.
 */
export interface KakaoSource {
  /**
   * 1~8통을 입력한 순서대로 보낸다. 한 통은 200자까지이고, 넘으면 자르지 않고 입력 오류로 거부한다.
   * 하나라도 검사에 걸리면 아무것도 보내지 않는다. `dryRun`이면 보내지 않고 보낼 내용과 글자 수만 돌려준다
   * (`KAKAO_DRY_RUN`이 켜져 있으면 항상 드라이런).
   */
  sendManyToMe(messages: readonly string[], opts?: { dryRun?: boolean }): Promise<SendResult>;
}

/** 앱에 내보내는 함수의 허용 목록. 더하려면 이 목록과 명세(`kakao-send-tools`)를 의도적으로 고친다. */
export const KAKAO_ALLOWED = ["sendManyToMe"] as const;

export interface KakaoDeps {
  logger: Logger;
  fetchFn?: FetchFn;
}

/** 이미 만든 `KakaoApi`를 앱용 객체로 감싼다(허용된 함수만). */
export function toKakaoSource(api: KakaoApi): KakaoSource {
  return { sendManyToMe: (messages, opts = {}) => api.sendMany(messages, opts) };
}

function createAuth(config: KakaoConfig, fetchFn?: FetchFn): KakaoAuth {
  return new KakaoAuth(new TokenStore(config.envFilePath), () => config, fetchFn);
}

export function createKakaoSource(config: KakaoConfig, deps: KakaoDeps): KakaoSource {
  return toKakaoSource(new KakaoApi(createAuth(config, deps.fetchFn), deps.logger, { linkUrl: config.linkUrl, dryRunAll: config.dryRunAll, fetchFn: deps.fetchFn }));
}

/** 앱의 `auth-status` 명령용: 설정이 있는지만 본다(네트워크 없음, 값은 돌려주지 않는다). */
export function kakaoStatus(config: KakaoConfig): Promise<{ restApiKey: boolean; clientSecret: boolean; refreshToken: boolean }> {
  return createAuth(config).status();
}
