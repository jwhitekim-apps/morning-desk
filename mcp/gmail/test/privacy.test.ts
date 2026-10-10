// my-task original code (not derived from upstream).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { GMAIL_READONLY_SCOPE, TokenProvider, type FetchFn } from "../src/auth/oauth";
import { TokenStore } from "../src/auth/store";
import { GmailApi } from "../src/gmail/api";
import { GmailClient } from "../src/gmail/client";
import { createLogger } from "../src/logger";
import { createServer } from "../src/server";

// 응답이나 로그에 나타나면 안 되는 값들.
const REFRESH = "1//REFRESH-TOKEN-SECRET";
const ACCESS = "ya29.ACCESS-TOKEN-SECRET";
const CLIENT_SECRET = "GOCSPX-CLIENT-SECRET";
const SUBJECT = "극비 인사 발령 안내";
const BODY = "본문에만 있는 기밀 문장 7f3a";
const SNIPPET = "미리보기 기밀 문구 9c2d";
const SENDER = "boss-secret@example.com";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gmail-mcp-privacy-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const headers = [{ name: "Subject", value: SUBJECT }, { name: "From", value: SENDER }, { name: "To", value: SENDER }, { name: "Date", value: "x" }];

/** 토큰 엔드포인트와 Gmail을 함께 흉내 낸다. `mode`로 오류 경로를 고른다. */
function world(mode: "ok" | "gmail-404" | "token-revoked" | "thread-fails") {
  const fetchFn: FetchFn = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.hostname === "oauth2.googleapis.com") {
      return mode === "token-revoked"
        ? json({ error: "invalid_grant", error_description: `revoked for ${SENDER}` }, 400)
        : json({ access_token: ACCESS, expires_in: 3600 });
    }
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    if (mode === "gmail-404") return json({ error: { message: `no such mail: ${SUBJECT}` } }, 404);
    if (path === "/messages") return json({ messages: [{ id: "m1", threadId: "t1" }] });
    if (path.startsWith("/threads/")) return mode === "thread-fails" ? json({ error: { message: SUBJECT } }, 500) : json({ messages: [{ id: "m1", internalDate: "1", payload: { headers } }] });
    if (url.searchParams.get("format") === "full") {
      return json({ id: "m1", threadId: "t1", internalDate: "1", payload: { mimeType: "text/plain", headers, body: { data: Buffer.from(BODY).toString("base64url") } } });
    }
    return json({ id: "m1", threadId: "t1", snippet: SNIPPET, internalDate: "1", payload: { headers } });
  }) as FetchFn;

  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const store = new TokenStore(join(dir, "token.json"));
  store.write({ refresh_token: REFRESH, scope: GMAIL_READONLY_SCOPE, saved_at: "2026-01-01T00:00:00Z" });
  const auth = new TokenProvider(store, () => ({ clientId: "cid", clientSecret: CLIENT_SECRET }), fetchFn);
  const gmail = new GmailApi(new GmailClient(auth, logger, { fetchFn, sleep: async () => undefined }), logger);
  return { ctx: { logger, auth, gmail }, lines };
}

async function runAllTools(mode: Parameters<typeof world>[0]) {
  const { ctx, lines } = world(mode);
  const server = createServer(ctx);
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(s), client.connect(c)]);
  const out: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    out.push((res.content as { text: string }[]).map((p) => p.text).join(""));
  };
  await call("auth_status", {});
  await call("search_emails", { query: "x", days: 3 });
  await call("read_email", { id: "m1" });
  return { responses: out, logs: lines.join("") };
}

describe("tokens, subjects and bodies stay out of logs", () => {
  for (const mode of ["ok", "gmail-404", "token-revoked", "thread-fails"] as const) {
    it(`logs hold no secrets or mail content (${mode})`, async () => {
      const { logs } = await runAllTools(mode);
      expect(logs.length).toBeGreaterThan(0); // 로그가 아예 없어서 통과하는 일을 막는다
      for (const secret of [REFRESH, ACCESS, CLIENT_SECRET, SUBJECT, BODY, SNIPPET, SENDER, "Bearer"]) {
        expect(logs, `${secret} leaked into logs`).not.toContain(secret);
      }
    });
  }

  it("logs contain counts and timings", async () => {
    const { logs } = await runAllTools("ok");
    expect(logs).toContain('"count":1');
    expect(logs).toMatch(/"durationMs":\d+/);
  });
});

describe("tokens stay out of tool responses", () => {
  for (const mode of ["ok", "gmail-404", "token-revoked", "thread-fails"] as const) {
    it(`no token or client secret in any response (${mode})`, async () => {
      const { responses } = await runAllTools(mode);
      for (const secret of [REFRESH, ACCESS, CLIENT_SECRET]) expect(responses.join("\n"), `${secret} leaked into a response`).not.toContain(secret);
    });
  }

  it("error responses do not echo Google's error text (which can contain mail content)", async () => {
    const { responses } = await runAllTools("gmail-404");
    expect(responses.join("\n")).not.toContain(SUBJECT);
    expect(responses.join("\n")).toContain("not_found");
  });

  it("a revoked sign-in is reported as auth_expired with a login hint, without the address in Google's text", async () => {
    const { responses } = await runAllTools("token-revoked");
    const text = responses.join("\n");
    expect(text).toContain("auth_expired");
    expect(text).toContain("login");
    expect(text).not.toContain(SENDER);
  });

  it("the mail content itself is returned where it is the point (read_email), so the checks above are meaningful", async () => {
    const { responses } = await runAllTools("ok");
    expect(responses.join("\n")).toContain(BODY);
  });
});
