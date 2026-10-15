// my-task original code (not derived from upstream).
import { loadConfig as folioConfig } from "@morning-desk/folio";
import { loadConfig as githubConfig } from "@morning-desk/github";
import { loadConfig as gmailConfig } from "@morning-desk/gmail";
import { loadConfig as kakaoConfig } from "@morning-desk/kakao";
import { loadConfig as todoConfig } from "@morning-desk/microsoft-todo";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const ENV = {
  PATH: "/usr/bin",
  HOME: "/home/u",
  LOG_LEVEL: "debug",
  MY_TASK_ENV_FILE: "/repo/.env.local",
  GMAIL_CLIENT_ID: "gid",
  GMAIL_CLIENT_SECRET: "gsecret",
  KAKAO_REST_API_KEY: "kkey",
  KAKAO_CLIENT_SECRET: "ksecret",
  KAKAO_REFRESH_TOKEN: "krefresh",
  KAKAO_LINK_URL: "https://x",
  GITHUB_MCP_TOKEN: "ghtoken",
  GITHUB_MCP_NOTIFICATIONS_TOKEN: "ghnotif",
  FOLIO_SUPABASE_URL: "https://s",
  FOLIO_SUPABASE_KEY: "fkey",
  MS_TODO_CLIENT_ID: "msid",
  MS_TODO_TOKEN_CACHE_DATA: "tcache",
  GMAIL_REFRESH_TOKEN: "grefresh",
  LOCAL_LLM_API_KEY: "llmkey",
  SUPABASE_SERVICE_KEY: "admin-key",
  UNRELATED: "x",
};

describe("loadConfig (app)", () => {
  it("reads the app's own settings with safe defaults", () => {
    const c = loadConfig(ENV, "/repo");
    expect(c.logLevel).toBe("debug");
    expect(c.repoRoot).toBe("/repo");
    expect(c.createTasks).toBe(false);
    expect(c.maxCreates).toBe(10);
    expect(c.sources).toEqual({ gmail: true, github: true, folio: true });
    expect(c.githubNotifications).toBe(true);
    expect(c.llm.apiKey).toBe("llmkey");
  });
});

// 같은 프로세스라도 각 소스 모듈은 자기 설정만 받는다(최소 권한). 토큰 값은 설정이 아니라 `.env.local`의 자기 줄에서 모듈이 직접 읽는다.
describe("each source's config holds only its own values", () => {
  const configs = {
    gmail: gmailConfig(ENV),
    kakao: kakaoConfig(ENV),
    github: githubConfig(ENV),
    folio: folioConfig(ENV),
    todo: todoConfig(ENV),
  };
  const own: Record<keyof typeof configs, RegExp> = {
    gmail: /gsecret/,
    kakao: /ksecret/,
    github: /ghtoken/,
    folio: /fkey/,
    todo: /msid/,
  };
  const others = ["gsecret", "ksecret", "ghtoken", "ghnotif", "fkey", "msid", "llmkey", "admin-key", "krefresh", "tcache", "grefresh", "UNRELATED"];

  for (const [name, config] of Object.entries(configs) as [keyof typeof configs, object][]) {
    it(`${name} sees its own settings and no other source's secret, the model key, a token value or the admin key`, () => {
      const text = JSON.stringify(config);
      expect(text).toMatch(own[name]);
      for (const secret of others.filter((s) => !own[name].test(s) && !(name === "github" && s === "ghnotif"))) expect(text, `${name}: ${secret}`).not.toContain(secret);
    });
  }

  it("the token-writing sources write to the configured .env.local", () => {
    expect(configs.gmail.envFilePath).toBe("/repo/.env.local");
    expect(configs.kakao.envFilePath).toBe("/repo/.env.local");
    expect(configs.todo.envFilePath).toBe("/repo/.env.local");
  });
});
