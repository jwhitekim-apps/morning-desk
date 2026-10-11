// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { issue, json, NOTIF_TOKEN, search, SEARCH_TOKEN, setup, type Req } from "./helpers";

const TITLE = "극비 비공개 저장소 이슈 제목 5c2e";
const REPO = "secret-corp/secret-repo";
const path = (r: Req) => r.url.pathname;

type Mode = "ok" | "bad-token" | "rate-limit" | "server-error" | "write-scopes";

function handler(mode: Mode) {
  return (r: Req) => {
    const p = path(r);
    if (p === "/user") {
      if (mode === "bad-token") return json({ message: `Bad credentials ${SEARCH_TOKEN}` }, 401);
      return json({ login: "me" }, 200, mode === "write-scopes" ? { "x-oauth-scopes": "repo, workflow" } : {});
    }
    if (mode === "rate-limit") return json({ message: `rate limit ${NOTIF_TOKEN}` }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1800000100" });
    if (mode === "server-error") return json({ message: TITLE }, 500);
    if (p === "/search/issues") return search([issue(1, { title: TITLE, repository_url: `https://api.github.com/repos/${REPO}`, milestone: { title: TITLE, due_on: "2026-10-14T15:00:00Z" } })]);
    if (p.endsWith("/timeline")) return json([{ event: "review_requested", actor: { login: "alice" }, requested_reviewer: { login: "me" } }]);
    if (p === "/notifications") return json([{ id: "1", reason: "mention", updated_at: "2026-10-10T00:00:00Z", repository: { full_name: REPO }, subject: { title: TITLE, type: "Issue", url: `https://api.github.com/repos/${REPO}/issues/1` } }]);
    return undefined;
  };
}

async function runAll(mode: Mode) {
  const s = setup(handler(mode), { now: 1_800_000_000_000 });
  const server = createServer({ logger: s.logger, github: s.api });
  const [c, sv] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(sv), client.connect(c)]);
  const out: string[] = [];
  for (const name of ["auth_status", "list_review_requests", "list_assigned_items", "list_notifications"]) {
    const res = await client.callTool({ name, arguments: {} });
    out.push((res.content as { text: string }[]).map((p) => p.text).join(""));
  }
  return { responses: out, logs: s.lines.join(""), requests: s.requests };
}

const MODES: Mode[] = ["ok", "bad-token", "rate-limit", "server-error", "write-scopes"];

describe("tokens and issue titles stay out of logs", () => {
  for (const mode of MODES) {
    it(`logs hold no tokens or titles (${mode})`, async () => {
      const { logs } = await runAll(mode);
      expect(logs.length).toBeGreaterThan(0); // 로그가 아예 없어서 통과하는 일을 막는다
      for (const secret of [SEARCH_TOKEN, NOTIF_TOKEN, "Bearer", TITLE, "극비", REPO, "secret-corp"]) expect(logs, `${secret} leaked into logs`).not.toContain(secret);
    });
  }

  it("logs hold counts and timings", async () => {
    const { logs } = await runAll("ok");
    expect(logs).toContain('"count":1');
    expect(logs).toMatch(/"durationMs":\d+/);
  });
});

describe("tokens stay out of tool responses", () => {
  for (const mode of MODES) {
    it(`no token in any response (${mode})`, async () => {
      const { responses } = await runAll(mode);
      for (const secret of [SEARCH_TOKEN, NOTIF_TOKEN]) expect(responses.join("\n"), `${secret} leaked`).not.toContain(secret);
    });
  }

  it("error responses do not echo GitHub's message text (which can hold issue titles)", async () => {
    for (const mode of ["bad-token", "rate-limit", "server-error"] as const) {
      const { responses } = await runAll(mode);
      expect(responses.join("\n"), mode).not.toContain("극비");
    }
  });

  it("a rate-limited response carries the retry time", async () => {
    const { responses } = await runAll("rate-limit");
    expect(responses.join("\n")).toContain("rate_limited");
    expect(responses.join("\n")).toMatch(/retryAt/);
  });

  it("a token with write scopes is refused and reported as a config error", async () => {
    const { responses, requests } = await runAll("write-scopes");
    expect(responses[1]).toContain("config_error");
    expect(requests.some((r) => path(r) === "/search/issues")).toBe(false);
  });

  it("only the successful reads return titles, which is their purpose", async () => {
    const { responses } = await runAll("ok");
    expect(responses.slice(1).join("\n")).toContain(TITLE);
  });
});

describe("every request that goes out is a GET", () => {
  for (const mode of MODES) {
    it(`only GET (${mode})`, async () => {
      const { requests } = await runAll(mode);
      expect(requests.length).toBeGreaterThan(0);
      expect(new Set(requests.map((r) => r.method))).toEqual(new Set(["GET"]));
    });
  }
});
