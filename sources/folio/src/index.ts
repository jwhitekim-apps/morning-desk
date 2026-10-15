// my-task original code (not derived from upstream).
import type { Logger } from "@morning-desk/shared";
import type { FolioConfig } from "./config";
import { FolioApi, type FetchFn, type PaperList } from "./folio/api";

export { loadConfig, type FolioConfig } from "./config";
export { AppError as FolioError, type ErrorCode as FolioErrorCode } from "./errors";
export { DEFAULT_LIMIT, MAX_LIMIT, SYNCED_AT_NOTE, type Paper, type PaperList } from "./folio/api";

/**
 * 앱이 폴리오에 대해 할 수 있는 일의 전부(읽기 전용). 데이터베이스에는 조회(GET)만 보낸다.
 * 시각(`syncedAt`)은 Zotero에서 마지막으로 **동기화된** 시각이고 처음 저장한 시각이 아니다.
 * 다시 가져올 때마다 바뀌므로 그것만으로 "새 논문"이라고 판단하지 않는다(모든 응답의 `note`에도 같은 안내가 있다).
 */
export interface FolioSource {
  /** 동기화 시각 최신순. `since`(YYYY-MM-DD는 한국 시간 그날 0시, 또는 ISO 8601) 이후만. 상한에 걸리면 `truncated`. */
  listRecentPapers(input?: { since?: string; maxResults?: number }): Promise<PaperList>;
  /** 제목에 글자가 들어 있는 논문(대소문자 무시, 기호도 글자 그대로). 빈 검색어는 입력 오류. */
  searchPapers(input: { query: string; maxResults?: number }): Promise<PaperList>;
}

/** 앱에 내보내는 함수의 허용 목록. 더하려면 이 목록과 명세(`folio-tools`)를 의도적으로 고친다. */
export const FOLIO_ALLOWED = ["listRecentPapers", "searchPapers"] as const;

export interface FolioDeps {
  logger: Logger;
  fetchFn?: FetchFn;
  sleep?: (ms: number) => Promise<void>;
}

export function createFolioSource(config: FolioConfig, deps: FolioDeps): FolioSource {
  const api = new FolioApi(deps.logger, { url: config.url, key: config.key, table: config.table, fetchFn: deps.fetchFn, sleep: deps.sleep });
  return {
    listRecentPapers: (input = {}) => api.listRecent(input),
    searchPapers: (input) => api.search(input),
  };
}
