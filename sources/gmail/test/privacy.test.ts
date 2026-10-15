// my-task original code (not derived from upstream).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TokenProvider, type FetchFn } from "../src/auth/oauth";
import { TokenStore } from "../src/auth/store";
import { GmailApi } from "../src/gmail/api";
import { GmailClient } from "../src/gmail/client";
import { createLogger } from "@morning-desk/shared";
import { toAppError } from "../src/errors";
import { toGmailSource } from "../src/index";

// 응답이나 로그에 나타나면 안 되는 값들.
const REFRESH = "1//REFRESH-TOKEN-SECRET";
const ACCESS = "ya29.ACCESS-TOKEN-SECRET";
const CLIENT_SECRET = "GOCSPX-CLIENT-SECRET";
const SUBJECT = "극비 인사 발령 안내";
const BODY = "본문에만 있는 기밀 문장 7f3a";
const SNIPPET = "미리보기 기밀 문구 9c2d";
const SENDER = "boss-secret@example.com";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "gmail-privacy-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const headers = [{ name: "Subject", value: SUBJECT }, { name: "From", value: SENDER }, { name: "To", value: SENDER }, { name: "Date", value: "x" }];

/** 토큰 엔드포인트와 Gmail을 함께 흉내 낸다. `mode`로 오류 경로를 고른다. */
async function world(mode: "ok" | "gmail-404" | "token-revoked" | "thread-fails") {
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
  const envPath = join(dir, ".env.local");
  const envBefore = sharedEnv({ GMAIL_REFRESH_TOKEN: REFRESH, GMAIL_CLIENT_SECRET: CLIENT_SECRET });
  writeFileSync(envPath, envBefore, { mode: 0o600 });
  const store = new TokenStore(envPath);
  const auth = new TokenProvider(store, () => ({ clientId: "cid", clientSecret: CLIENT_SECRET }), fetchFn);
  const gmail = new GmailApi(new GmailClient(auth, logger, { fetchFn, sleep: async () => undefined }), logger);
  return { ctx: { logger, auth, gmail }, lines, envPath, envBefore };
}

/** 모든 함수를 한 번씩 부르고, 앱이 받는 결과(또는 오류)를 글자로 모은다. 순서: 로그인 상태, 검색, 본문 읽기. */
async function runAllTools(mode: Parameters<typeof world>[0]) {
  const { ctx, lines, envPath, envBefore } = await world(mode);
  const gmail = toGmailSource(ctx.gmail);
  const out: string[] = [];
  const call = async (fn: () => Promise<unknown>) => {
    try {
      out.push(JSON.stringify(await fn()));
    } catch (err) {
      const e = toAppError(err);
      // 앱이 하는 것처럼 실패를 오류 코드로 기록한다(예전에는 MCP 서버 층이 기록했다).
      ctx.logger.warn("source call failed", { source: "gmail", errorCode: e.code });
      out.push(JSON.stringify({ error: e.toJSON() }) + e.message);
    }
  };
  await call(() => ctx.auth.status());
  await call(() => gmail.searchEmails({ query: "x", days: 3 }));
  await call(() => gmail.readEmail("m1"));
  return { responses: out, logs: lines.join(""), envPath, envBefore };
}

/** 실제 `.env.local`처럼 정리된 파일: 다른 서버들의 비밀과 이 서버의 토큰이 함께 있다. */
function sharedEnv(own: Record<string, string>): string {
  const v = (k: string, d: string) => `${k}=${own[k] ?? d}`;
  return [
    "# Gmail",
    v("GMAIL_CLIENT_ID", "gmail-client-id-0101"),
    v("GMAIL_CLIENT_SECRET", "gmail-client-secret-0102"),
    "",
    "# 카카오",
    v("KAKAO_REST_API_KEY", "kakao-rest-key-0201"),
    v("KAKAO_CLIENT_SECRET", "kakao-client-secret-0202"),
    "KAKAO_LINK_URL=https://to-do.live.com/tasks/",
    "",
    "# GitHub · 모델",
    "GITHUB_MCP_TOKEN=ghp-github-token-0301",
    "LOCAL_LLM_API_KEY=llm-api-key-0401",
    "",
    "# --- 토큰 (자동 갱신, 직접 고치지 마세요)",
    v("MS_TODO_TOKEN_CACHE_DATA", "dG9kby1jYWNoZS0wNTAx"),
    v("GMAIL_REFRESH_TOKEN", "gmail-refresh-0601"),
    v("KAKAO_REFRESH_TOKEN", "kakao-refresh-0701"),
    v("VELOO_SESSION", "access_token=veloo-session-0801"),
    "",
  ].join("\n");
}

/** 주소가 아닌 모든 값(비밀로 다룬다). */
const envValues = (text: string): string[] =>
  text.split("\n").map((l) => /^[A-Z_]+=(.+)$/.exec(l)?.[1]).filter((x): x is string => Boolean(x) && !x!.startsWith("https://"));

/** 자기 키 줄을 뺀 나머지가 글자 그대로인지 본다. */
const withoutKey = (text: string, key: string): string => text.split("\n").filter((l) => !l.startsWith(`${key}=`)).join("\n");

describe("the shared .env.local", () => {
  for (const mode of ["ok", "gmail-404", "token-revoked", "thread-fails"] as const) {
    it(`no value from it reaches logs or responses, and other lines stay as they were (${mode})`, async () => {
      const { logs, responses, envPath, envBefore } = await runAllTools(mode);
      const seen = `${logs}\n${responses.join("\n")}`;
      for (const value of envValues(envBefore)) expect(seen, `${value} leaked`).not.toContain(value);
      const after = readFileSync(envPath, "utf-8");
      expect(withoutKey(after, "GMAIL_REFRESH_TOKEN")).toBe(withoutKey(envBefore, "GMAIL_REFRESH_TOKEN"));
    });
  }
});

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

describe("tokens stay out of results and errors", () => {
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
    expect(text).toContain("morning-desk login gmail");
    expect(text).not.toContain(SENDER);
  });

  it("the mail content itself is returned where it is the point (readEmail), so the checks above are meaningful", async () => {
    const { responses } = await runAllTools("ok");
    expect(responses.join("\n")).toContain(BODY);
  });
});
