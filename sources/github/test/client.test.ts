// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { AppError } from "../src/errors";
import { assertReadOnlyScopes } from "../src/github/client";
import { json, NOTIF_TOKEN, SEARCH_TOKEN, search, setup, type Req } from "./helpers";

const path = (r: Req) => r.url.pathname;

describe("token scope check", () => {
  it("allows read:* and notifications, and tokens without a scope header", () => {
    for (const ok of [null, "", "read:org", "read:user, read:org", "notifications", "notifications, read:user"]) expect(() => assertReadOnlyScopes(ok), String(ok)).not.toThrow();
  });

  it("rejects anything that could write or administer, naming the scopes", () => {
    for (const bad of ["repo", "repo, workflow", "gist, read:org", "write:packages", "admin:org", "delete_repo", "public_repo", "user"]) {
      expect(() => assertReadOnlyScopes(bad), bad).toThrowError(/beyond read-only/);
    }
    expect(() => assertReadOnlyScopes("gist, read:org, repo")).toThrowError(/gist, repo/);
  });

  it("a token with write scopes is refused before any other request (like the gh login token)", async () => {
    const s = setup((r) => (path(r) === "/user" ? json({ login: "me" }, 200, { "x-oauth-scopes": "gist, read:org, repo, workflow" }) : search([])));
    await expect(s.api.assigned()).rejects.toMatchObject({ code: "config_error", message: expect.stringContaining("repo") });
    expect(s.requests.map(path)).toEqual(["/user"]);
    expect(s.requests.some((r) => path(r) === "/search/issues")).toBe(false);
  });

  it("checks once per token and only then runs requests; a failed check is retried next time", async () => {
    let scopes = "repo";
    const s = setup((r) => (path(r) === "/user" ? json({ login: "me" }, 200, { "x-oauth-scopes": scopes }) : search([])));
    await expect(s.api.assigned()).rejects.toMatchObject({ code: "config_error" });
    scopes = "read:org";
    await expect(s.api.assigned()).resolves.toMatchObject({ items: [] });
    await s.api.assigned();
    expect(s.requests.filter((r) => path(r) === "/user")).toHaveLength(2); // 실패 한 번 + 성공 한 번, 이후는 캐시
  });

  it("each token is checked with its own token", async () => {
    const s = setup((r) => (path(r) === "/notifications" ? json([]) : path(r) === "/search/issues" ? search([]) : undefined));
    await s.api.notifications();
    await s.api.assigned();
    const users = s.requests.filter((r) => path(r) === "/user").map((r) => r.headers.Authorization);
    expect(users).toEqual([`Bearer ${NOTIF_TOKEN}`, `Bearer ${SEARCH_TOKEN}`]);
  });
});

describe("requests", () => {
  it("only GET, with the bearer token, API version and a user agent", async () => {
    const s = setup((r) => (path(r) === "/search/issues" ? search([]) : undefined));
    await s.api.assigned();
    expect(new Set(s.requests.map((r) => r.method))).toEqual(new Set(["GET"]));
    expect(s.requests[0]!.headers).toMatchObject({ Authorization: `Bearer ${SEARCH_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28", Accept: "application/vnd.github+json" });
    expect(s.requests[0]!.headers["User-Agent"]).toBeTruthy();
  });

  it("no search token -> config_error without any request", async () => {
    const s = setup(() => undefined, { token: null });
    await expect(s.api.assigned()).rejects.toMatchObject({ code: "config_error", message: expect.stringContaining("GITHUB_MCP_TOKEN") });
    expect(s.requests).toHaveLength(0);
  });
});

describe("failures are told apart", () => {
  const failing = (status: number, body: object = {}, headers: Record<string, string> = {}) => setup((r) => (path(r) === "/search/issues" ? json(body, status, headers) : undefined));

  it("401 -> auth_failed, 403 -> permission_denied, 404 -> not_found, 422 -> validation_error", async () => {
    await expect(failing(401).api.assigned()).rejects.toMatchObject({ code: "auth_failed" });
    await expect(failing(403, { message: "Resource not accessible by personal access token" }).api.assigned()).rejects.toMatchObject({ code: "permission_denied" });
    await expect(failing(404).api.assigned()).rejects.toMatchObject({ code: "not_found" });
    await expect(failing(422).api.assigned()).rejects.toMatchObject({ code: "validation_error" });
  });

  it("rate limit by reset time: rate_limited with the Korea-time moment to try again", async () => {
    const now = 1_800_000_000_000;
    const reset = Math.floor(now / 1000) + 120;
    const s = setup((r) => (path(r) === "/search/issues" ? json({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) }) : undefined), { now });
    const err = (await s.api.assigned().catch((e: AppError) => e)) as AppError;
    expect(err).toMatchObject({ code: "rate_limited", retryAfterSeconds: 120 });
    const expected = new Date(now + 120_000 + 9 * 3600_000).toISOString().slice(0, 19) + "+09:00";
    expect(err.retryAt).toBe(expected);
    expect(err.message).toContain(expected);
    expect(JSON.stringify(err.toJSON())).toContain(expected);
    expect(s.requests.filter((r) => path(r) === "/search/issues")).toHaveLength(2); // 이슈·PR 검색 한 번씩. 한도 초과는 재시도하지 않는다
  });

  it("secondary rate limit by Retry-After (429 and 403)", async () => {
    await expect(failing(429, {}, { "retry-after": "60" }).api.assigned()).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 60 });
    await expect(failing(403, { message: "You have exceeded a secondary rate limit" }, { "retry-after": "30" }).api.assigned()).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 30 });
  });

  it("a rate limit without any timing info still says rate_limited", async () => {
    await expect(failing(403, { message: "API rate limit exceeded for user" }).api.assigned()).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("5xx and network failures are retried then reported as unavailable", async () => {
    const down = failing(503);
    await expect(down.api.assigned()).rejects.toMatchObject({ code: "unavailable" });
    expect(down.requests.filter((r) => path(r) === "/search/issues")).toHaveLength(6); // 이슈·PR 검색 각각 3번(처음 + 재시도 2번)
    const net = setup((r) => (path(r) === "/search/issues" ? new Error("ECONNRESET api.github.com") : undefined));
    const err = await net.api.assigned().catch((e: Error) => e);
    expect(err).toMatchObject({ code: "unavailable" });
    expect(String((err as Error).message)).not.toContain("ECONNRESET");
  });

  it("does not retry a 401 and never echoes GitHub's message text", async () => {
    const s = failing(401, { message: "제목 비밀 이슈 Bad credentials" });
    const err = await s.api.assigned().catch((e: Error) => e);
    expect(JSON.stringify(err) + String((err as Error).message)).not.toContain("비밀");
    expect(s.requests.filter((r) => path(r) === "/search/issues")).toHaveLength(2); // 이슈·PR 검색 한 번씩, 재시도 없음
  });

  it("a non-array items field is reported as a changed structure", async () => {
    const s = setup((r) => (path(r) === "/search/issues" ? json({ total_count: 1, items: "nope" }) : undefined));
    await expect(s.api.assigned()).rejects.toMatchObject({ code: "upstream_error" });
  });
});
