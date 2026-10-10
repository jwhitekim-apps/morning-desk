// my-task original code (not derived from upstream).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { KakaoAuth, TokenStore, type FetchFn } from "../src/auth/provider";
import { KakaoApi } from "../src/kakao/api";
import { createLogger } from "../src/logger";
import { createServer } from "../src/server";

const REFRESH = "REFRESH-TOKEN-SECRET-0001";
const ACCESS = "ACCESS-TOKEN-SECRET-0002";
const CLIENT_SECRET = "CLIENT-SECRET-0003";
const REST_KEY = "REST-API-KEY-0004";
const BODY = "오늘 브리핑 기밀 문장 4e1b";
const BODY2 = "두 번째 통 기밀 문장 77aa";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "kakao-mcp-privacy-")); });
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
  const auth = new KakaoAuth(new TokenStore(join(dir, "token.json")), () => ({ restApiKey: REST_KEY, clientSecret: CLIENT_SECRET, refreshToken: REFRESH }), fetchFn);
  const kakao = new KakaoApi(auth, logger, { linkUrl: "https://example.com", dryRunAll: false, fetchFn });
  return { ctx: { logger, auth, kakao }, lines };
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
  await call("send_to_me", { text: BODY });
  await call("send_many_to_me", { messages: [BODY, BODY2] });
  await call("send_to_me", { text: BODY, dryRun: true });
  await call("send_to_me", { text: "나".repeat(230) });
  return { responses: out, logs: lines.join("") };
}

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

describe("tokens stay out of tool responses", () => {
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
