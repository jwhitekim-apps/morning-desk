// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import type { Logger } from "@morning-desk/shared";

export type FetchFn = typeof fetch;

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 500;
const MAX_QUERY_CHARS = 100;
const COLUMNS = "item_key,title,year,synced_at";
const NO_TITLE = "(제목 없음)";

/** 시각이 무엇인지 밝히는 문구. 함수 설명과 모든 응답에 들어간다. */
export const SYNCED_AT_NOTE =
  "syncedAt is the time the paper's record was last SYNCED from Zotero, not when it was first saved. It changes every time the record is re-fetched, " +
  "so on its own it is not evidence that a paper is new.";

export interface Paper {
  itemKey: string;
  title: string;
  year: string | number | null;
  /** 마지막으로 동기화된 시각(한국 시간, ISO 8601). 처음 저장한 시각이 아니다. */
  syncedAt: string;
}

export interface PaperList {
  note: string;
  items: Paper[];
  /** 조건에 맞는 논문이 더 있는데 상한에 걸려 돌려주지 못했다. */
  truncated: boolean;
}

export interface FolioApiOptions {
  url: string | undefined;
  key: string | undefined;
  table: string;
  fetchFn?: FetchFn;
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

const kstIso = (ms: number): string => new Date(ms + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00";

/**
 * 기준 시각 해석. 날짜만("2026-10-10")이면 한국 시간 그날 00:00, 시간대 표시 없는 일시도 한국 시간,
 * 오프셋/Z가 붙었으면 그대로 따른다. 존재하지 않는 날짜는 거부한다.
 */
export function parseSince(text: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text.trim());
  if (!m) throw new AppError("validation_error", `Invalid since "${text}". Use YYYY-MM-DD or an ISO 8601 date-time.`);
  const [, y, mo, d, h = "00", mi = "00", s = "00", zone] = m;
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)));
  if (probe.getUTCFullYear() !== Number(y) || probe.getUTCMonth() !== Number(mo) - 1 || probe.getUTCDate() !== Number(d) || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) {
    throw new AppError("validation_error", `Invalid since "${text}": no such calendar date or time.`);
  }
  const offset = zone === undefined ? "+09:00" : zone === "Z" ? "Z" : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const ms = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${offset}`);
  if (!Number.isFinite(ms)) throw new AppError("validation_error", `Invalid since "${text}".`);
  return new Date(ms).toISOString();
}

/**
 * 제목 검색용 정규식. 검색어의 모든 기호를 글자 그대로 찾도록 이스케이프한다.
 * (PostgREST의 `ilike`는 `*`와 `%`, `_`가 와일드카드라 글자 그대로 찾기 어렵고, 정규식 이스케이프는 규칙이 분명하다.)
 */
export function escapeForRegex(term: string): string {
  return term.replace(/[^\p{L}\p{N}\s]/gu, "\\$&");
}

export class FolioApi {
  private readonly fetchFn: FetchFn;
  private readonly maxRetries: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly logger: Logger, private readonly opts: FolioApiOptions) {
    this.fetchFn = opts.fetchFn ?? fetch;
    this.maxRetries = opts.maxRetries ?? 2;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async listRecent(opts: { since?: string; maxResults?: number } = {}): Promise<PaperList> {
    const limit = this.limit(opts.maxResults);
    const query: Record<string, string> = { select: COLUMNS, order: "synced_at.desc", limit: String(limit + 1) };
    if (opts.since) query.synced_at = `gte.${parseSince(opts.since)}`;
    return this.run("list", query, limit);
  }

  async search(opts: { query: string; maxResults?: number }): Promise<PaperList> {
    const term = opts.query.trim();
    if (!term) throw new AppError("validation_error", "Search text is empty.");
    if (Array.from(term).length > MAX_QUERY_CHARS) throw new AppError("validation_error", `Search text is longer than ${MAX_QUERY_CHARS} characters.`);
    const limit = this.limit(opts.maxResults);
    return this.run("search", { select: COLUMNS, order: "synced_at.desc", limit: String(limit + 1), title: `imatch.${escapeForRegex(term)}` }, limit);
  }

  private limit(requested: number | undefined): number {
    return Math.min(Math.max(Math.floor(requested ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  }

  private async run(op: string, query: Record<string, string>, limit: number): Promise<PaperList> {
    const rows = await this.get(op, query);
    const items = rows.slice(0, limit).map(toPaper);
    const truncated = rows.length > limit;
    this.logger.info("papers read", { op, count: items.length, truncated });
    return { note: SYNCED_AT_NOTE, items, truncated };
  }

  /** 조회(GET)만 보낸다. 429와 5xx, 네트워크 오류는 읽기라서 안전하게 짧게 재시도한다. */
  private async get(op: string, query: Record<string, string>): Promise<unknown[]> {
    const { url, key, table } = this.opts;
    if (!url || !key) throw new AppError("config_error", "FOLIO_SUPABASE_URL and FOLIO_SUPABASE_KEY must be set.");
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new AppError("config_error", "FOLIO_TABLE must be a plain table or view name.");
    let base: URL;
    try {
      base = new URL(url);
    } catch {
      throw new AppError("config_error", "FOLIO_SUPABASE_URL is not a valid URL.");
    }
    if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") {
      throw new AppError("config_error", "FOLIO_SUPABASE_URL must use https (the key is sent to it).");
    }
    const target = new URL(`/rest/v1/${table}`, base);
    for (const [k, v] of Object.entries(query)) target.searchParams.set(k, v);

    for (let attempt = 0; ; attempt++) {
      const startedAt = Date.now();
      let res: Response | null = null;
      try {
        res = await this.fetchFn(target, { method: "GET", headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" } });
      } catch {
        /* 아래에서 재시도하거나 '일시 장애'로 알린다 */
      }
      this.logger.debug("folio request", { op, status: res?.status ?? 0, attempt, durationMs: Date.now() - startedAt });
      if (res?.ok) {
        const body: unknown = await res.json().catch(() => null);
        if (!Array.isArray(body)) throw new AppError("upstream_error", "The papers table returned an unexpected response shape.", { status: res.status });
        return body;
      }
      const retryAfter = Number.parseInt(res?.headers.get("retry-after") ?? "", 10);
      const status = res?.status ?? 0;
      if ((res === null || status === 429 || status >= 500) && attempt < this.maxRetries) {
        const waitMs = Math.min((Number.isFinite(retryAfter) ? retryAfter : 2 ** attempt * 0.5) * 1000, 10_000);
        this.logger.warn("folio retry", { op, status, attempt, waitMs });
        await this.sleep(waitMs);
        continue;
      }
      if (res === null) throw new AppError("unavailable", "Could not reach the Folio database. Check the network and try again.");
      throw await mapError(res, Number.isFinite(retryAfter) ? retryAfter : undefined);
    }
  }
}

/** 응답 한 행을 확인해서 논문으로 바꾼다. 필수 필드가 없으면 구조가 바뀐 것이므로 조용히 넘기지 않고 오류로 알린다. */
function toPaper(row: unknown): Paper {
  const r = row as Record<string, unknown> | null;
  const key = r?.item_key;
  const synced = r?.synced_at;
  if (!r || typeof key !== "string" || !key || typeof synced !== "string" || !Number.isFinite(Date.parse(synced))) {
    throw new AppError("upstream_error", "A row is missing item_key or synced_at: the papers table structure may have changed.");
  }
  const title = typeof r.title === "string" && r.title.trim() ? r.title : NO_TITLE;
  const year = typeof r.year === "string" || typeof r.year === "number" ? r.year : null;
  return { itemKey: key, title, year, syncedAt: kstIso(Date.parse(synced)) };
}

async function mapError(res: Response, retryAfterSeconds: number | undefined): Promise<AppError> {
  const body = (await res.json().catch(() => ({}))) as { code?: string };
  const status = res.status;
  // 설명문(message)은 쓰지 않는다. 고정 문구와 분류만 쓴다.
  if (status === 401 || status === 403) return new AppError("auth_failed", "The database rejected the key (invalid, expired, or not allowed to read this table).", { status });
  if (status === 404 || body.code === "PGRST205" || body.code === "42P01") {
    return new AppError("table_not_found", "The papers table (or view) was not found. Check FOLIO_TABLE.", { status });
  }
  if (status === 400) return new AppError("validation_error", "The database rejected the query.", { status });
  if (status === 429) return new AppError("rate_limited", "The database is throttling requests.", { status, retryAfterSeconds });
  if (status >= 500) return new AppError("unavailable", "The database is temporarily unavailable.", { status });
  return new AppError("upstream_error", "The database returned an unexpected error.", { status });
}
