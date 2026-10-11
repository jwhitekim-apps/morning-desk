// my-task original code (not derived from upstream).
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { COOKIE, json, loginOk, makeDir, PASSWORD, setup, task, USERNAME, type Req } from "./helpers";

const NAME = "극비 태스크 이름 8d1f";
const MEMO = "극비 메모 내용 3b7c";

const cleanups: (() => void)[] = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

type Mode = "ok" | "expired" | "login-fail" | "down" | "contract-broken";

function handler(mode: Mode) {
  let first = true;
  return (r: Req) => {
    if (r.path === "/login") return mode === "login-fail" ? json({ error: `틀렸습니다 ${USERNAME}` }, 401) : loginOk();
    if (mode === "down") return json({ detail: NAME }, 503);
    if (mode === "expired" && first) { first = false; return json({ detail: "세션이 만료됐습니다." }, 401); }
    if (mode === "contract-broken") return json([{ id: 1, name: NAME }]);
    if (r.path === "/todo/api/todos") return json([task(1, { name: NAME, memo: MEMO, deadline: "2026-10-13" })]);
    if (r.path === "/todo/api/reviews/weekly") return json({ completed: 1, created: 2, overdue: [{ name: NAME }] });
    return undefined;
  };
}

async function runAll(mode: Mode) {
  // 모드마다 새 세션 파일을 쓴다. 앞 모드에서 저장된 세션이 뒤 모드의 결과를 바꾸지 않게 한다.
  const own = makeDir();
  cleanups.push(own.cleanup);
  // 이 서버의 세션 줄은 비워 두고 시작한다(각 모드가 로그인부터 시작하게).
  const envBefore = sharedEnv({}).replace(/^VELOO_SESSION=.*\n/m, "");
  writeFileSync(own.path, envBefore, { mode: 0o600 });
  const s = setup(handler(mode), { sessionPath: own.path });
  const server = createServer({ logger: s.logger, veloo: s.api });
  const [c, sv] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(sv), client.connect(c)]);
  const out: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    out.push((res.content as { text: string }[]).map((p) => p.text).join(""));
  };
  await call("veloo_auth_status", {});
  await call("veloo_list_tasks", {});
  await call("veloo_weekly_review", { weekStart: "2026-10-05" });
  return { responses: out, logs: s.lines.join(""), requests: s.requests, envPath: own.path, envBefore };
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


const MODES: Mode[] = ["ok", "expired", "login-fail", "down", "contract-broken"];
const SECRETS = [USERNAME, PASSWORD, COOKIE, "SESSION-COOKIE-SECRET"];

describe("the account and session stay out of logs and responses", () => {
  for (const mode of MODES) {
    it(`logs and responses hold no account or session (${mode})`, async () => {
      const { logs, responses } = await runAll(mode);
      expect(logs.length).toBeGreaterThan(0); // 로그가 아예 없어서 통과하는 일을 막는다
      for (const secret of SECRETS) {
        expect(logs, `${secret} in logs`).not.toContain(secret);
        expect(responses.join("\n"), `${secret} in responses`).not.toContain(secret);
      }
    });
  }

  it("logs hold counts and timings, never task names or memos", async () => {
    for (const mode of MODES) {
      const { logs } = await runAll(mode);
      for (const secret of [NAME, MEMO, "극비"]) expect(logs, `${mode}: ${secret}`).not.toContain(secret);
    }
    expect((await runAll("ok")).logs).toMatch(/"count":1/);
  });

  it("error responses do not echo Veloo's text (which can contain task names)", async () => {
    for (const mode of ["down", "login-fail", "contract-broken"] as const) {
      const { responses } = await runAll(mode);
      expect(responses.join("\n"), mode).not.toContain("극비");
    }
  });

  it("errors are distinct per cause", async () => {
    expect((await runAll("login-fail")).responses[1]).toContain("auth_failed");
    expect((await runAll("down")).responses[1]).toContain("unavailable");
    expect((await runAll("contract-broken")).responses[1]).toContain("contract_changed");
  });

  it("only the successful reads return names and memos, which is their purpose", async () => {
    const { responses } = await runAll("ok");
    expect(responses[1]).toContain(NAME);
    expect(responses[1]).toContain(MEMO);
  });
});

describe("write requests never go out", () => {
  for (const mode of MODES) {
    it(`only GET plus the login POST (${mode})`, async () => {
      const { requests } = await runAll(mode);
      for (const r of requests) {
        if (r.method === "POST") expect(r.path).toBe("/login");
        else expect(r.method).toBe("GET");
      }
    });
  }
});

describe("the shared .env.local", () => {
  for (const mode of MODES) {
    it(`no value from it reaches logs or responses, and other lines stay as they were (${mode})`, async () => {
      const { logs, responses, envPath, envBefore } = await runAll(mode);
      const seen = `${logs}\n${responses.join("\n")}`;
      for (const value of [...envValues(envBefore), COOKIE]) expect(seen, `${value} leaked`).not.toContain(value);
      const after = readFileSync(envPath, "utf-8");
      expect(withoutKey(after, "VELOO_SESSION")).toBe(withoutKey(envBefore, "VELOO_SESSION"));
    });
  }
});
