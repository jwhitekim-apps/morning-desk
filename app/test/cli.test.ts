// my-task original code (not derived from upstream).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/cli";

let repo: string;
const VALUES = {
  GMAIL_CLIENT_ID: "gmail-client-id-0101",
  GMAIL_CLIENT_SECRET: "gmail-client-secret-0102",
  KAKAO_REST_API_KEY: "kakao-rest-key-0201",
  KAKAO_CLIENT_SECRET: "kakao-client-secret-0202",
  GITHUB_MCP_TOKEN: "ghp-github-token-0301",
  GITHUB_MCP_REPOS: "secret-corp/secret-repo",
  FOLIO_SUPABASE_URL: "https://secretproject.supabase.co",
  FOLIO_SUPABASE_KEY: "folio-key-0501",
  LOCAL_LLM_API_KEY: "llm-api-key-0401",
  GMAIL_REFRESH_TOKEN: "gmail-refresh-0601",
  KAKAO_REFRESH_TOKEN: "kakao-refresh-0701",
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "morning-desk-cli-"));
  const text = Object.entries(VALUES).map(([k, v]) => `${k}=${v}`).join("\n");
  writeFileSync(join(repo, ".env.local"), `${text}\n`, { mode: 0o600 });
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

async function cli(args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  // 테스트가 실제 환경 변수를 바꾸지 않도록 빈 환경에서 시작한다(`.env.local`만 읽힌다).
  const code = await runCli(args, { out: (t) => out.push(t), err: (t) => err.push(t), env: { PATH: process.env.PATH }, repoRoot: repo });
  return { code, out: out.join(""), err: err.join("") };
}

describe("the command line", () => {
  it("login and logout need a known source; anything else is a usage error (exit 2)", async () => {
    for (const args of [["login"], ["login", "kakao"], ["logout", "github"], ["login", "nope"]]) {
      const r = await cli(args);
      expect(r.code, args.join(" ")).toBe(2);
      expect(r.err).toContain("needs a source: todo or gmail");
    }
  });

  it("an unknown command is a usage error, and list-tools is gone", async () => {
    expect((await cli(["list-tools"])).code).toBe(2);
    expect((await cli(["serve"])).code).toBe(2);
  });

  it("auth-status reports every source as present/absent and prints no value from .env.local", async () => {
    const r = await cli(["auth-status"]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("To Do: 로그인 필요 (morning-desk login todo)");
    expect(r.out).toContain("Gmail: 로그인됨 (읽기 전용), OAuth 클라이언트 있음");
    expect(r.out).toContain("카카오: REST API 키 있음, 클라이언트 시크릿 있음, 리프레시 토큰 있음");
    expect(r.out).toContain("GitHub: 검색 토큰 있음, 알림 토큰 없음, 저장소 제한 1개");
    expect(r.out).toContain("폴리오: 주소 있음, 키 있음");
    for (const value of Object.values(VALUES)) expect(`${r.out}${r.err}`, value).not.toContain(value);
  });

  it("help lists the new commands", async () => {
    const r = await cli(["--help"]);
    for (const c of ["run", "login <todo|gmail>", "logout <todo|gmail>", "auth-status", "migrate-tokens"]) expect(r.out).toContain(c);
    expect(r.out).not.toContain("list-tools");
  });
});
