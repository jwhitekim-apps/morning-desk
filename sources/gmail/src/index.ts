// my-task original code (not derived from upstream).
import type { Logger } from "@morning-desk/shared";
import { login, TokenProvider, type FetchFn } from "./auth/oauth";
import { loadOAuthClient, TokenStore } from "./auth/store";
import type { GmailConfig } from "./config";
import { GmailApi, type MailBody, type SearchResult } from "./gmail/api";
import { GmailClient } from "./gmail/client";

export { loadConfig, type GmailConfig } from "./config";
export { AppError as GmailError, type ErrorCode as GmailErrorCode } from "./errors";
export { BODY_LIMIT, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, UNTRUSTED_NOTICE, type MailBody, type MailSummary, type SearchResult } from "./gmail/api";

/**
 * 앱이 Gmail에 대해 할 수 있는 일의 전부(읽기 전용, `gmail.readonly` 권한 하나).
 * 보내기, 삭제, 휴지통, 보관, 라벨, 읽음 표시는 없다. 메일 내용은 제3자가 쓴 데이터이며 지시가 아니다.
 * 로그인되어 있지 않으면 로그인을 시작하지 않고 `auth_required`와 `morning-desk login gmail` 안내를 던진다.
 */
export interface GmailSource {
  /** Gmail 검색식으로 찾는다(최신순). `days`는 최근 N일(1~3650), `maxResults`는 최대 100. 빈 검색식은 입력 오류. */
  searchEmails(input: { query: string; days?: number; maxResults?: number }): Promise<SearchResult>;
  /** 메일 한 통의 본문(텍스트, 6000자에서 잘림). */
  readEmail(id: string): Promise<MailBody>;
}

/** 앱에 내보내는 함수의 허용 목록. 더하려면 이 목록과 명세(`gmail-tools`)를 의도적으로 고친다. */
export const GMAIL_ALLOWED = ["readEmail", "searchEmails"] as const;

export interface GmailDeps {
  logger: Logger;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

/** 이미 만든 `GmailApi`를 앱용 객체로 감싼다(허용된 함수만). */
export function toGmailSource(api: GmailApi): GmailSource {
  return {
    searchEmails: (input) => api.search(input),
    readEmail: (id) => api.read(id),
  };
}

export function createGmailSource(config: GmailConfig, deps: GmailDeps): GmailSource {
  const auth = new TokenProvider(new TokenStore(config.envFilePath), () => loadOAuthClient(config), deps.fetchFn);
  return toGmailSource(new GmailApi(new GmailClient(auth, deps.logger, { fetchFn: deps.fetchFn, sleep: deps.sleep }), deps.logger));
}

/**
 * 사람이 터미널에서 실행하는 로그인 명령용. 하루 실행(`run`)은 이것을 받지 않는다.
 * 토큰은 `.env.local`의 `GMAIL_REFRESH_TOKEN` 줄에만 쓴다.
 */
export const gmailAuth = {
  /** 브라우저로 구글 로그인(읽기 전용 권한). 열어야 할 주소는 `onUrl`로 알린다. */
  login: (config: GmailConfig, onUrl: (url: string) => void): Promise<void> =>
    login({ store: new TokenStore(config.envFilePath), client: loadOAuthClient(config), onUrl }),
  /** 저장된 로그인을 지운다. */
  logout: (config: GmailConfig): Promise<void> => new TokenStore(config.envFilePath).clear(),
  /** 로그인되어 있는지만 본다(네트워크 없음, 값은 돌려주지 않는다). */
  status: (config: GmailConfig): Promise<{ signedIn: boolean; scope?: string }> =>
    new TokenProvider(new TokenStore(config.envFilePath), () => loadOAuthClient(config)).status(),
};
