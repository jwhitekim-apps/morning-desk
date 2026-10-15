// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { repoAllowed, webUrlOf } from "../src/github/api";
import { issue, json, search, setup, type Req } from "./helpers";

const path = (r: Req) => r.url.pathname;

describe("list_review_requests", () => {
  const timeline = (actor: string | null, reviewer = "me") => json(actor ? [{ event: "commented" }, { event: "review_requested", actor: { login: actor }, requested_reviewer: { login: reviewer } }] : [{ event: "commented" }]);
  const route = (items: unknown[], tl: (n: string) => Response = () => timeline("alice")) => (r: Req) => {
    if (path(r) === "/search/issues") return search(items);
    const m = /\/issues\/(\d+)\/timeline$/.exec(path(r));
    if (m) return tl(m[1]!);
    return undefined;
  };

  it("returns repo, number, title, url, updatedAt (Korea time), author and who requested the review", async () => {
    const { api, requests } = setup(route([issue(7, { title: "리뷰 부탁" }), issue(8)], (n) => timeline(n === "7" ? "alice" : "bob")));
    const r = await api.reviewRequests();
    expect(r.items).toEqual([
      { repo: "o/r", number: 7, title: "리뷰 부탁", url: "https://github.com/o/r/pull/7", updatedAt: "2026-10-10T09:30:00+09:00", author: "author", requestedBy: "alice" },
      { repo: "o/r", number: 8, title: "제목 8", url: "https://github.com/o/r/pull/8", updatedAt: "2026-10-10T09:30:00+09:00", author: "author", requestedBy: "bob" },
    ]);
    const q = requests.find((x) => path(x) === "/search/issues")!.url.searchParams;
    expect(q.get("q")).toBe("is:pr is:open review-requested:@me archived:false");
    expect(q.get("sort")).toBe("updated");
    expect(q.get("order")).toBe("desc"); // 최근에 갱신된 것부터
  });

  it("no review requests is an empty list, not an error", async () => {
    const r = await setup(route([])).api.reviewRequests();
    expect(r).toMatchObject({ items: [], truncated: false, omittedByRepoFilter: 0 });
  });

  it("only uses a review_requested event aimed at me, taking the latest one", async () => {
    const tl = () => json([
      { event: "review_requested", actor: { login: "old" }, requested_reviewer: { login: "me" } },
      { event: "review_requested", actor: { login: "other" }, requested_reviewer: { login: "someone-else" } },
      { event: "review_requested", actor: { login: "newest" }, requested_reviewer: { login: "ME" } },
    ]);
    expect((await setup(route([issue(1)], tl)).api.reviewRequests()).items[0]).toMatchObject({ requestedBy: "newest" });
  });

  it("when the timeline has no such event or fails, the item is still returned and the gap is marked", async () => {
    const none = await setup(route([issue(1)], () => timeline(null))).api.reviewRequests();
    expect(none.items[0]).toMatchObject({ requestedBy: null, requestedByUnavailable: true });
    const failing = await setup(route([issue(1)], () => json({}, 404))).api.reviewRequests();
    expect(failing.items[0]).toMatchObject({ title: "제목 1", requestedBy: null, requestedByUnavailable: true });
  });

  it("flags truncation when GitHub has more matches than the limit", async () => {
    const r = await setup(route([issue(1), issue(2)], undefined)).api.reviewRequests({ maxResults: 2 });
    expect(r.truncated).toBe(false);
    const more = setup((req) => (path(req) === "/search/issues" ? search([issue(1), issue(2)], 57) : path(req).endsWith("/timeline") ? timeline("a") : undefined));
    expect((await more.api.reviewRequests({ maxResults: 2 })).truncated).toBe(true);
  });

  it("clamps the limit to 1..100", async () => {
    const s = setup((r) => (path(r) === "/search/issues" ? search([]) : undefined));
    await s.api.reviewRequests({ maxResults: 9999 });
    await s.api.reviewRequests({ maxResults: 0 });
    expect(s.requests.filter((r) => path(r) === "/search/issues").map((r) => r.url.searchParams.get("per_page"))).toEqual(["100", "1"]);
  });
});

describe("list_assigned_items", () => {
  /** is:issue / is:pr 검색을 구분해서 각각의 목록을 돌려준다. */
  const byType = (issues: unknown[], prs: unknown[], totals: { issues?: number; prs?: number } = {}) => (r: Req) => {
    if (path(r) !== "/search/issues") return undefined;
    const q = r.url.searchParams.get("q") ?? "";
    return q.includes("is:issue") ? search(issues, totals.issues ?? issues.length) : search(prs, totals.prs ?? prs.length);
  };

  it("searches issues and pull requests separately (GitHub requires is:issue or is:pr) and merges them, newest first", async () => {
    const s = setup(byType(
      [issue(1, { updated_at: "2026-10-01T00:00:00Z" }), issue(2, { updated_at: "2026-10-09T00:00:00Z" })],
      [issue(3, { updated_at: "2026-10-05T00:00:00Z", pull_request: { url: "x" } })],
    ));
    const items = (await s.api.assigned()).items;
    expect(items.map((i) => [i.number, i.type])).toEqual([[2, "issue"], [3, "pull_request"], [1, "issue"]]);
    const qs = s.requests.filter((r) => path(r) === "/search/issues").map((r) => r.url.searchParams.get("q")).sort();
    expect(qs).toEqual(["is:issue is:open assignee:@me archived:false", "is:pr is:open assignee:@me archived:false"]);
  });

  it("includes the milestone's due date as a Korea date, and marks items without a deadline", async () => {
    const { api } = setup(byType(
      [
        issue(1, { milestone: { title: "v1.0", due_on: "2026-10-14T15:00:00Z" } }), // 한국 10/15
        issue(2, { milestone: { title: "백로그", due_on: null } }),
        issue(3, { milestone: null }),
      ],
      [issue(4, { pull_request: { url: "x" }, milestone: { title: "v1.0", due_on: "2026-10-15T07:00:00Z" } })], // 미국 서부에서 만든 마감
    ));
    const items = (await api.assigned()).items.sort((a, b) => a.number - b.number);
    expect(items.map((i) => [i.number, i.type, i.milestone?.dueDate ?? null, i.noDeadline])).toEqual([
      [1, "issue", "2026-10-15", false],
      [2, "issue", null, true],
      [3, "issue", null, true],
      [4, "pull_request", "2026-10-15", false],
    ]);
    expect(items[0]!.milestone).toEqual({ title: "v1.0", dueDate: "2026-10-15", dueOn: "2026-10-14T15:00:00Z" });
    expect(items[2]!.milestone).toBeNull();
  });

  it("an unparseable due_on does not break the list", async () => {
    const { api } = setup(byType([issue(1, { milestone: { title: "m", due_on: "garbage" } })], []));
    expect((await api.assigned()).items[0]).toMatchObject({ noDeadline: true, milestone: { dueDate: null } });
  });

  it("applies the limit to the merged list and flags truncation", async () => {
    const issues = [1, 2, 3].map((n) => issue(n, { updated_at: `2026-10-0${n}T00:00:00Z` }));
    const prs = [4, 5, 6].map((n) => issue(n, { updated_at: `2026-10-0${n}T00:00:00Z`, pull_request: {} }));
    const r = await setup(byType(issues, prs)).api.assigned({ maxResults: 4 });
    expect(r.items.map((i) => i.number)).toEqual([6, 5, 4, 3]);
    expect(r.truncated).toBe(true);
    expect((await setup(byType([issue(1)], [])).api.assigned({ maxResults: 4 })).truncated).toBe(false);
  });

  it("flags truncation from total_count even when each page fits, and incomplete search results", async () => {
    expect((await setup(byType([issue(1)], [], { issues: 400 })).api.assigned({ maxResults: 1 })).truncated).toBe(true);
    const { api } = setup((r) => (path(r) === "/search/issues" ? json({ total_count: 1, incomplete_results: true, items: [issue(1)] }) : undefined));
    expect(await api.assigned({ maxResults: 5 })).toMatchObject({ incomplete: true });
  });
});

describe("list_notifications", () => {
  const notif = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    reason: "review_requested",
    updated_at: "2026-10-10T00:30:00Z",
    repository: { full_name: "o/r" },
    subject: { title: `알림 ${id}`, type: "PullRequest", url: `https://api.github.com/repos/o/r/pulls/${id}` },
    ...over,
  });

  it("returns unread notifications with web urls; two consecutive reads give the same list and send only GETs", async () => {
    const s = setup((r) => (path(r) === "/notifications" ? json([notif("12"), notif("13", { subject: { title: "이슈", type: "Issue", url: "https://api.github.com/repos/o/r/issues/13" } })]) : undefined));
    const a = await s.api.notifications();
    const b = await s.api.notifications();
    expect(b).toEqual(a);
    expect(a.items.map((n) => [n.id, n.url])).toEqual([["12", "https://github.com/o/r/pull/12"], ["13", "https://github.com/o/r/issues/13"]]);
    expect(a.items[0]).toMatchObject({ repo: "o/r", reason: "review_requested", type: "PullRequest", updatedAt: "2026-10-10T09:30:00+09:00" });
    expect(new Set(s.requests.map((r) => r.method))).toEqual(new Set(["GET"]));
    const n = s.requests.find((r) => path(r) === "/notifications")!;
    expect(n.url.searchParams.get("all")).toBe("false"); // 읽지 않은 것만
    expect(s.requests.some((r) => /\/notifications\/threads/.test(path(r)))).toBe(false); // 읽음 표시 호출 없음
  });

  it("uses the notifications token, not the search token", async () => {
    const s = setup((r) => (path(r) === "/notifications" ? json([]) : undefined));
    await s.api.notifications();
    expect(s.requests.every((r) => r.headers.Authorization === "Bearer ghp_NOTIFICATIONS-TOKEN-SECRET-0002")).toBe(true);
  });

  it("flags truncation from the Link header", async () => {
    const s = setup((r) => (path(r) === "/notifications" ? json([notif("1")], 200, { link: '<https://api.github.com/notifications?page=2>; rel="next"' }) : undefined));
    expect((await s.api.notifications({ maxResults: 1 })).truncated).toBe(true);
  });

  it("without the notifications token only this tool reports a config error; the others still work", async () => {
    const s = setup((r) => (path(r) === "/search/issues" ? search([]) : undefined), { notificationsToken: null });
    await expect(s.api.notifications()).rejects.toMatchObject({ code: "config_error", message: expect.stringContaining("notifications tool is off") });
    expect(s.requests).toHaveLength(0);
    await expect(s.api.assigned()).resolves.toMatchObject({ items: [] });
    expect(s.api.status()).toMatchObject({ searchToken: true, notificationsToken: false });
  });

  it("webUrlOf converts known API urls and returns null for unknown shapes", () => {
    expect(webUrlOf("https://api.github.com/repos/o/r/commits/abc")).toBe("https://github.com/o/r/commit/abc");
    expect(webUrlOf("https://api.github.com/repos/o/r/releases/5")).toBe("https://github.com/o/r/release/5".replace("release", "releases"));
    expect(webUrlOf("https://evil.example/repos/o/r/issues/1")).toBeNull();
    expect(webUrlOf(null)).toBeNull();
  });
});

describe("repository filter", () => {
  it("repoAllowed matches exact names and owner/* patterns, ignoring case", () => {
    expect(repoAllowed("o/r", [])).toBe(true);
    expect(repoAllowed("O/R", ["o/r"])).toBe(true);
    expect(repoAllowed("o/other", ["o/r"])).toBe(false);
    expect(repoAllowed("o/other", ["o/*"])).toBe(true);
    expect(repoAllowed("oo/x", ["o/*"])).toBe(false);
  });

  it("drops results from other repositories and says how many were dropped", async () => {
    const s = setup((r) => (path(r) === "/search/issues" ? (r.url.searchParams.get("q")!.includes("is:issue") ? search([issue(1), issue(2, { repository_url: "https://api.github.com/repos/other/secret" })]) : search([])) : undefined), { repos: ["o/*"] });
    const r = await s.api.assigned();
    expect(r.items.map((i) => i.repo)).toEqual(["o/r"]);
    expect(r.omittedByRepoFilter).toBe(1);
  });

  it("does not even look up the timeline of a filtered-out pull request", async () => {
    const s = setup((r) => (path(r) === "/search/issues" ? search([issue(2, { repository_url: "https://api.github.com/repos/other/secret" })]) : undefined), { repos: ["o/*"] });
    await s.api.reviewRequests();
    expect(s.requests.some((r) => r.url.pathname.includes("/timeline"))).toBe(false);
  });
});
