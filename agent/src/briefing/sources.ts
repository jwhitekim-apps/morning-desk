// my-task original code (not derived from upstream).
import { z } from "zod";
import type { ToolCaller } from "../mcp/pool";
import { describeFailure, type SourceLabel } from "./failures";

/** 모델에 넣을 메일. 본문은 상한이 있는 일부만 읽는다. */
export interface MailItem {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
  /** 같은 스레드에서 가장 먼저 받은 메일의 제목(후속 메일을 원래 일과 묶는 데 쓴다). */
  threadSubject?: string;
  /** 본문을 읽은 메일만. 잘렸으면 `truncated`. */
  body?: string;
  truncated?: boolean;
}

export interface GithubItem {
  kind: "review_request" | "assigned" | "notification";
  repo: string;
  /** 알림은 번호가 없을 수 있다. */
  id: string;
  title: string;
  url: string | null;
  updatedAt: string;
  /** 배정 항목의 마일스톤 마감일(한국 날짜). 없으면 null. */
  dueDate?: string | null;
}

export interface PaperItem {
  itemKey: string;
  title: string;
  syncedAt: string;
}

export interface Sources {
  mails: MailItem[];
  github: GithubItem[];
  papers: PaperItem[];
}

export interface CollectOptions {
  /** 켜 둔 소스. 기본은 셋 다. */
  enabled?: { gmail?: boolean; github?: boolean; folio?: boolean };
  /** 알림용 토큰이 있을 때만 알림을 읽는다(없는 것은 실패가 아니라 선택 기능이 꺼진 것이다). */
  githubNotifications?: boolean;
  mailQuery?: string;
  mailDays?: number;
  mailMax?: number;
  /** 본문까지 읽을 메일의 최대 개수. */
  bodyMax?: number;
  /** 이미 처리한 소스의 id. 다시 읽지 않는다. */
  processed?: { mail?: ReadonlySet<string>; github?: ReadonlySet<string> };
  paperDays?: number;
}

export interface Collected {
  sources: Sources;
  /** 읽지 못한 소스와 이유(`Gmail 로그인 만료`). 소스마다 한 줄. */
  failures: string[];
}

const DEFAULT_MAIL_QUERY = "in:inbox -category:promotions -category:social";

const MailSearch = z.object({
  items: z.array(
    z.object({ id: z.string(), threadId: z.string(), subject: z.string(), from: z.string(), date: z.string(), snippet: z.string(), threadSubject: z.string().optional() }).passthrough(),
  ),
});
const MailRead = z.object({ body: z.string(), truncated: z.boolean().optional() }).passthrough();
const Items = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) }).passthrough();
const Review = z.object({ repo: z.string(), number: z.number(), title: z.string(), url: z.string(), updatedAt: z.string() }).passthrough();
const Assigned = z.object({ repo: z.string(), number: z.number(), title: z.string(), url: z.string(), updatedAt: z.string(), milestone: z.object({ dueDate: z.string().nullable() }).passthrough().nullable().optional() }).passthrough();
const Notification = z.object({ id: z.string(), repo: z.string(), reason: z.string(), title: z.string(), url: z.string().nullable(), updatedAt: z.string() }).passthrough();
const Papers = Items(z.object({ itemKey: z.string(), title: z.string(), syncedAt: z.string() }).passthrough());

function parse<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const r = schema.safeParse(raw);
  if (!r.success) throw Object.assign(new Error("unexpected shape"), { shape: true });
  return r.data;
}

async function settle<T>(source: SourceLabel, fn: () => Promise<T>, failures: string[], empty: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // 응답 모양이 어긋난 것도 실패로 드러낸다(조용히 빈 목록으로 보지 않는다).
    const shaped = (err as { shape?: boolean }).shape ? new Error("shape") : err;
    failures.push(describeFailure(source, shaped));
    return empty;
  }
}

async function collectGmail(caller: ToolCaller, o: CollectOptions): Promise<MailItem[]> {
  const found = parse(MailSearch, await caller.call("gmail", "search_emails", { query: o.mailQuery ?? DEFAULT_MAIL_QUERY, days: o.mailDays ?? 2, maxResults: o.mailMax ?? 30 }));
  const done = o.processed?.mail ?? new Set<string>();
  const fresh: MailItem[] = found.items.filter((m) => !done.has(m.id)).map((m) => ({ id: m.id, threadId: m.threadId, subject: m.subject, from: m.from, date: m.date, snippet: m.snippet, ...(m.threadSubject ? { threadSubject: m.threadSubject } : {}) }));
  // 본문은 한도 안에서 앞쪽(최근) 메일부터 읽는다. 한 통의 본문을 읽지 못해도 나머지는 계속한다.
  for (const mail of fresh.slice(0, o.bodyMax ?? 10)) {
    try {
      const read = parse(MailRead, await caller.call("gmail", "read_email", { id: mail.id }));
      mail.body = read.body;
      if (read.truncated) mail.truncated = true;
    } catch {
      /* 본문 없이 제목과 미리보기로 판단한다 */
    }
  }
  return fresh;
}

async function collectGithub(caller: ToolCaller, o: CollectOptions, failures: string[]): Promise<GithubItem[]> {
  const out: GithubItem[] = [];
  const done = o.processed?.github ?? new Set<string>();
  const once = (item: GithubItem) => { if (!done.has(item.id)) out.push(item); };
  let failed: string | null = null;
  const attempt = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { failed ??= describeFailure("GitHub", (err as { shape?: boolean }).shape ? new Error("shape") : err); }
  };
  await attempt(async () => {
    for (const r of parse(Items(Review), await caller.call("github", "list_review_requests", {}))
      .items) once({ kind: "review_request", repo: r.repo, id: `${r.repo}#${r.number}`, title: r.title, url: r.url, updatedAt: r.updatedAt });
  });
  await attempt(async () => {
    for (const a of parse(Items(Assigned), await caller.call("github", "list_assigned_items", {}))
      .items) once({ kind: "assigned", repo: a.repo, id: `${a.repo}#${a.number}`, title: a.title, url: a.url, updatedAt: a.updatedAt, dueDate: a.milestone?.dueDate ?? null });
  });
  if (o.githubNotifications) {
    await attempt(async () => {
      // CI 알림(`ci_activity`)은 매일 수십 건씩 쌓이는 소음이라 제외한다.
      for (const n of parse(Items(Notification), await caller.call("github", "list_notifications", {}))
        .items.filter((x) => x.reason !== "ci_activity")) once({ kind: "notification", repo: n.repo, id: `notif:${n.id}`, title: n.title, url: n.url, updatedAt: n.updatedAt });
    });
  }
  if (failed) failures.push(failed);
  return out;
}

async function collectFolio(caller: ToolCaller, now: Date, o: CollectOptions): Promise<PaperItem[]> {
  const since = new Date(now.getTime() + 9 * 3600_000 - (o.paperDays ?? 7) * 86_400_000).toISOString().slice(0, 10);
  const r = parse(Papers, await caller.call("folio", "list_recent_papers", { since, maxResults: 100 }));
  return r.items.map((p) => ({ itemKey: p.itemKey, title: p.title, syncedAt: p.syncedAt }));
}

/** 소스마다 정해진 도구를 부른다. 한 소스가 실패해도 나머지는 계속하고, 실패는 이유와 함께 돌려준다. */
export async function collectSources(caller: ToolCaller, now: Date, o: CollectOptions = {}): Promise<Collected> {
  const failures: string[] = [];
  const on = { gmail: true, github: true, folio: true, ...o.enabled };
  const mails = on.gmail ? await settle("Gmail", () => collectGmail(caller, o), failures, [] as MailItem[]) : [];
  const github = on.github ? await collectGithub(caller, o, failures) : [];
  const papers = on.folio ? await settle("폴리오", () => collectFolio(caller, now, o), failures, [] as PaperItem[]) : [];
  return { sources: { mails, github, papers }, failures };
}
