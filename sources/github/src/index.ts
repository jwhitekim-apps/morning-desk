// my-task original code (not derived from upstream).
import type { Logger } from "@morning-desk/shared";
import type { GithubConfig } from "./config";
import { GithubApi, type AssignedItem, type ListResult, type NotificationEntry, type ReviewRequest } from "./github/api";
import { GithubClient, type FetchFn } from "./github/client";

export { loadConfig, type GithubConfig } from "./config";
export { AppError as GithubError, type ErrorCode as GithubErrorCode } from "./errors";
export {
  DEFAULT_LIMIT,
  MAX_NOTIFICATION_LIMIT,
  MAX_SEARCH_LIMIT,
  UNTRUSTED_NOTICE,
  type AssignedItem,
  type ListResult,
  type NotificationEntry,
  type ReviewRequest,
} from "./github/api";

/**
 * 앱이 GitHub에 대해 할 수 있는 일의 전부(읽기 전용). GitHub에는 GET만 보낸다.
 * 입력은 개수 상한뿐이라 검색어, 저장소, 사람을 바꿔서 읽는 범위를 넓힐 수 없다.
 * 제목은 제3자가 쓴 글일 수 있으므로 데이터로만 다룬다(지시로 따르지 않는다).
 */
export interface GithubSource {
  /** 내게 리뷰가 요청된 열린 PR(최근 갱신순). 상한(최대 100)을 넘으면 잘리고 `truncated`. */
  listReviewRequests(input?: { maxResults?: number }): Promise<ListResult<ReviewRequest>>;
  /** 내게 배정된 열린 이슈와 PR, 마일스톤 마감(한국 날짜)과 함께. 마감이 없으면 `noDeadline`. */
  listAssignedItems(input?: { maxResults?: number }): Promise<ListResult<AssignedItem>>;
  /** 읽지 않은 알림(최대 50). 조회가 알림을 읽음으로 바꾸지 않는다. 알림용 토큰이 없으면 설정 오류. */
  listNotifications(input?: { maxResults?: number }): Promise<ListResult<NotificationEntry>>;
}

/** 앱에 내보내는 함수의 허용 목록. 더하려면 이 목록과 명세(`github-tools`)를 의도적으로 고친다. */
export const GITHUB_ALLOWED = ["listAssignedItems", "listNotifications", "listReviewRequests"] as const;

export interface GithubDeps {
  logger: Logger;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** 이미 만든 `GithubApi`를 앱용 객체로 감싼다(허용된 함수만). */
export function toGithubSource(api: GithubApi): GithubSource {
  return {
    listReviewRequests: (input = {}) => api.reviewRequests(input),
    listAssignedItems: (input = {}) => api.assigned(input),
    listNotifications: (input = {}) => api.notifications(input),
  };
}

export function createGithubSource(config: GithubConfig, deps: GithubDeps): GithubSource {
  const client = new GithubClient(deps.logger, { token: config.token, notificationsToken: config.notificationsToken, fetchFn: deps.fetchFn, sleep: deps.sleep, now: deps.now });
  return toGithubSource(new GithubApi(client, deps.logger, config.repos));
}

/** 앱의 `auth-status` 명령용: 어떤 토큰이 설정되어 있는지(값은 돌려주지 않는다)와 저장소 필터. */
export function githubStatus(config: GithubConfig): { searchToken: boolean; notificationsToken: boolean; repoFilter: string[] } {
  return { searchToken: Boolean(config.token), notificationsToken: Boolean(config.notificationsToken), repoFilter: [...config.repos] };
}
