// my-task original code (not derived from upstream).
import type { SourceModules } from "../modules";
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

async function settle<T>(source: SourceLabel, fn: () => Promise<T>, failures: string[], empty: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    failures.push(describeFailure(source, err));
    return empty;
  }
}

async function collectGmail(gmail: SourceModules["gmail"], o: CollectOptions): Promise<MailItem[]> {
  const found = await gmail.searchEmails({ query: o.mailQuery ?? DEFAULT_MAIL_QUERY, days: o.mailDays ?? 2, maxResults: o.mailMax ?? 30 });
  const done = o.processed?.mail ?? new Set<string>();
  const fresh: MailItem[] = found.items.filter((m) => !done.has(m.id)).map((m) => ({ id: m.id, threadId: m.threadId, subject: m.subject, from: m.from, date: m.date, snippet: m.snippet, ...(m.threadSubject ? { threadSubject: m.threadSubject } : {}) }));
  // 본문은 한도 안에서 앞쪽(최근) 메일부터 읽는다. 한 통의 본문을 읽지 못해도 나머지는 계속한다.
  for (const mail of fresh.slice(0, o.bodyMax ?? 10)) {
    try {
      const read = await gmail.readEmail(mail.id);
      mail.body = read.body;
      if (read.truncated) mail.truncated = true;
    } catch {
      /* 본문 없이 제목과 미리보기로 판단한다 */
    }
  }
  return fresh;
}

async function collectGithub(github: SourceModules["github"], o: CollectOptions, failures: string[]): Promise<GithubItem[]> {
  const out: GithubItem[] = [];
  const done = o.processed?.github ?? new Set<string>();
  const once = (item: GithubItem) => { if (!done.has(item.id)) out.push(item); };
  let failed: string | null = null;
  const attempt = async (fn: () => Promise<void>) => {
    try { await fn(); } catch (err) { failed ??= describeFailure("GitHub", err); }
  };
  await attempt(async () => {
    for (const r of (await github.listReviewRequests()).items) once({ kind: "review_request", repo: r.repo, id: `${r.repo}#${r.number}`, title: r.title, url: r.url, updatedAt: r.updatedAt });
  });
  await attempt(async () => {
    for (const a of (await github.listAssignedItems()).items) once({ kind: "assigned", repo: a.repo, id: `${a.repo}#${a.number}`, title: a.title, url: a.url, updatedAt: a.updatedAt, dueDate: a.milestone?.dueDate ?? null });
  });
  if (o.githubNotifications) {
    await attempt(async () => {
      // CI 알림(`ci_activity`)은 매일 수십 건씩 쌓이는 소음이라 제외한다.
      for (const n of (await github.listNotifications()).items.filter((x) => x.reason !== "ci_activity")) once({ kind: "notification", repo: n.repo, id: `notif:${n.id}`, title: n.title, url: n.url, updatedAt: n.updatedAt });
    });
  }
  if (failed) failures.push(failed);
  return out;
}

async function collectFolio(folio: SourceModules["folio"], now: Date, o: CollectOptions): Promise<PaperItem[]> {
  const since = new Date(now.getTime() + 9 * 3600_000 - (o.paperDays ?? 7) * 86_400_000).toISOString().slice(0, 10);
  const r = await folio.listRecentPapers({ since, maxResults: 100 });
  return r.items.map((p) => ({ itemKey: p.itemKey, title: p.title, syncedAt: p.syncedAt }));
}

/** 소스마다 정해진 함수를 부른다. 한 소스가 실패해도 나머지는 계속하고, 실패는 이유와 함께 돌려준다. */
export async function collectSources(modules: Pick<SourceModules, "gmail" | "github" | "folio">, now: Date, o: CollectOptions = {}): Promise<Collected> {
  const failures: string[] = [];
  const on = { gmail: true, github: true, folio: true, ...o.enabled };
  const mails = on.gmail ? await settle("Gmail", () => collectGmail(modules.gmail, o), failures, [] as MailItem[]) : [];
  const github = on.github ? await collectGithub(modules.github, o, failures) : [];
  const papers = on.folio ? await settle("폴리오", () => collectFolio(modules.folio, now, o), failures, [] as PaperItem[]) : [];
  return { sources: { mails, github, papers }, failures };
}
