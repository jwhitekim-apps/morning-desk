// my-task original code (not derived from upstream).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KakaoAuth, TokenStore, type FetchFn } from "../src/auth/provider";
import { KakaoApi } from "../src/kakao/api";
import { createLogger } from "@morning-desk/shared";
import { toAppError } from "../src/errors";
import { toKakaoSource } from "../src/index";

const REFRESH = "REFRESH-TOKEN-SECRET-0001";
const ACCESS = "ACCESS-TOKEN-SECRET-0002";
const CLIENT_SECRET = "CLIENT-SECRET-0003";
const REST_KEY = "REST-API-KEY-0004";
const BODY = "오늘 브리핑 기밀 문장 4e1b";
const BODY2 = "두 번째 통 기밀 문장 77aa";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kakao-privacy-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function world(mode: "ok" | "send-500" | "token-revoked" | "refresh-rotates") {
  const fetchFn: FetchFn = (async (input: string | URL | Request) => {
    const host = new URL(String(input)).hostname;
    if (host === "kauth.kakao.com") {
      if (mode === "token-revoked") return json({ error: "invalid_grant", error_description: `no token for ${BODY}` }, 400);
      return json({ access_token: ACCESS, expires_in: 3600, ...(mode === "refresh-rotates" ? { refresh_token: "ROTATED-REFRESH-0005" } : {}) });
    }
    return mode === "send-500" ? json({ msg: BODY }, 500) : json({ result_code: 0 });
  }) as FetchFn;
  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const envPath = join(dir, ".env.local");
  const envBefore = sharedEnv({ KAKAO_REFRESH_TOKEN: REFRESH, KAKAO_REST_API_KEY: REST_KEY, KAKAO_CLIENT_SECRET: CLIENT_SECRET });
  writeFileSync(envPath, envBefore, { mode: 0o600 });
  const auth = new KakaoAuth(new TokenStore(envPath), () => ({ restApiKey: REST_KEY, clientSecret: CLIENT_SECRET }), fetchFn);
  const kakao = new KakaoApi(auth, logger, { linkUrl: "https://example.com", dryRunAll: false, fetchFn });
  return { ctx: { logger, auth, kakao }, lines, envPath, envBefore };
}

/** 모든 함수를 한 번씩 부르고, 앱이 받는 결과(또는 오류)를 글자로 모은다. 순서: 설정 상태, 한 통, 두 통, 드라이런, 한도 초과. */
async function runAllTools(mode: Parameters<typeof world>[0]) {
  const { ctx, lines, envPath, envBefore } = world(mode);
  const kakao = toKakaoSource(ctx.kakao);
  const out: string[] = [];
  const call = async (fn: () => Promise<unknown>) => {
    try {
      out.push(JSON.stringify(await fn()));
    } catch (err) {
      const e = toAppError(err);
      out.push(JSON.stringify({ error: e.toJSON() }) + e.message);
    }
  };
  await call(() => ctx.auth.status());
  await call(() => kakao.sendManyToMe([BODY]));
  await call(() => kakao.sendManyToMe([BODY, BODY2]));
  await call(() => kakao.sendManyToMe([BODY], { dryRun: true }));
  await call(() => kakao.sendManyToMe(["나".repeat(230)]));
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


const SECRETS = [REFRESH, ACCESS, CLIENT_SECRET, REST_KEY, "ROTATED-REFRESH-0005", "Bearer"];
const MODES = ["ok", "send-500", "token-revoked", "refresh-rotates"] as const;

describe("tokens and message bodies stay out of logs", () => {
  for (const mode of MODES) {
    it(`logs hold no tokens or message text (${mode})`, async () => {
      const { logs } = await runAllTools(mode);
      expect(logs.length).toBeGreaterThan(0); // 로그가 아예 없어서 통과하는 일을 막는다
      for (const secret of [...SECRETS, BODY, BODY2, "기밀"]) expect(logs, `${secret} leaked into logs`).not.toContain(secret);
    });
  }

  it("logs hold character counts", async () => {
    const { logs } = await runAllTools("ok");
    expect(logs).toContain(`"chars":${Array.from(BODY).length}`);
  });
});

describe("tokens stay out of results and errors", () => {
  for (const mode of MODES) {
    it(`no token or secret in any response (${mode})`, async () => {
      const { responses } = await runAllTools(mode);
      for (const secret of SECRETS) expect(responses.join("\n"), `${secret} leaked into a response`).not.toContain(secret);
    });
  }

  it("real-send and error responses do not echo the message text or Kakao's error text", async () => {
    for (const mode of ["ok", "send-500", "token-revoked"] as const) {
      const { responses } = await runAllTools(mode);
      const real = responses.filter((_r, i) => i === 1 || i === 2 || i === 4); // 실제 전송 2건과 한도 초과 오류
      for (const r of real) expect(r, mode).not.toContain("기밀");
    }
  });

  it("only the dry run returns the text, which is its purpose", async () => {
    const { responses } = await runAllTools("ok");
    expect(responses[3]).toContain(BODY);
  });

  it("a revoked token is reported as auth_expired with a sign-in hint", async () => {
    const { responses } = await runAllTools("token-revoked");
    expect(responses[1]).toContain("auth_expired");
    expect(responses[1]).toContain("Sign in to Kakao again");
  });
});

describe("the shared .env.local", () => {
  for (const mode of MODES) {
    it(`no value from it reaches logs or responses, and other lines stay as they were (${mode})`, async () => {
      const { logs, responses, envPath, envBefore } = await runAllTools(mode);
      const seen = `${logs}\n${responses.join("\n")}`;
      for (const value of envValues(envBefore)) expect(seen, `${value} leaked`).not.toContain(value);
      const after = readFileSync(envPath, "utf-8");
      expect(withoutKey(after, "KAKAO_REFRESH_TOKEN")).toBe(withoutKey(envBefore, "KAKAO_REFRESH_TOKEN"));
      const line = after.split("\n").find((l) => l.startsWith("KAKAO_REFRESH_TOKEN="));
      expect(line).toBe(`KAKAO_REFRESH_TOKEN=${mode === "refresh-rotates" ? "ROTATED-REFRESH-0005" : REFRESH}`);
    });
  }
});
