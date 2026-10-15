// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { loadConfig, type ServerName } from "../src/config";

const ENV = {
  PATH: "/usr/bin",
  HOME: "/home/u",
  LOG_LEVEL: "debug",
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
  LOCAL_LLM_API_KEY: "llmkey",
  SUPABASE_SERVICE_KEY: "admin-key",
  UNRELATED: "x",
};

describe("loadConfig", () => {
  const config = loadConfig(ENV, "/repo");
  const secretsOf = (name: ServerName) => Object.keys(config.servers[name].env).sort();

  it("points each server at its built entry file", () => {
    expect(config.servers.todo.entry).toBe("/repo/mcp/microsoft-todo/dist/index.js");
    expect(config.servers.gmail.entry).toBe("/repo/mcp/gmail/dist/index.js");
    expect(config.servers.kakao.entry).toBe("/repo/mcp/kakao/dist/index.js");
    expect(config.servers.github.entry).toBe("/repo/mcp/github/dist/index.js");
    expect(config.servers.folio.entry).toBe("/repo/mcp/folio/dist/index.js");
    expect(config.logLevel).toBe("debug");
  });

  it("each server gets only its own variables plus the base ones (least privilege)", () => {
    expect(secretsOf("gmail")).toEqual(["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "HOME", "MY_TASK_ENV_FILE", "PATH"]);
    expect(secretsOf("kakao")).toEqual(["HOME", "KAKAO_CLIENT_SECRET", "KAKAO_LINK_URL", "KAKAO_REST_API_KEY", "MY_TASK_ENV_FILE", "PATH"]);
    expect(secretsOf("github")).toEqual(["GITHUB_MCP_NOTIFICATIONS_TOKEN", "GITHUB_MCP_TOKEN", "HOME", "MY_TASK_ENV_FILE", "PATH"]);
    expect(secretsOf("folio")).toEqual(["FOLIO_SUPABASE_KEY", "FOLIO_SUPABASE_URL", "HOME", "MY_TASK_ENV_FILE", "PATH"]);
    expect(secretsOf("todo")).toEqual(["HOME", "MS_TODO_CLIENT_ID", "MY_TASK_ENV_FILE", "PATH"]);
  });

  it("every server gets the root .env.local path, and no token value or token folder is passed", () => {
    const withTokens = loadConfig(
      { ...ENV, MS_TODO_TOKEN_CACHE: "/old", GMAIL_MCP_DIR: "/old", KAKAO_MCP_DIR: "/old", MS_TODO_TOKEN_CACHE_DATA: "tcache", GMAIL_REFRESH_TOKEN: "grefresh", VELOO_SESSION: "vsession" },
      "/repo",
    );
    for (const n of Object.keys(withTokens.servers) as ServerName[]) {
      const env = withTokens.servers[n].env;
      expect(env.MY_TASK_ENV_FILE).toBe("/repo/.env.local");
      expect(Object.keys(env)).not.toEqual(expect.arrayContaining(["MS_TODO_TOKEN_CACHE"]));
      expect(JSON.stringify(env)).not.toMatch(/krefresh|tcache|grefresh|vsession|_MCP_DIR|\/old/);
    }
  });

  it("no server ever sees another server's secret, the model key, or the admin database key", () => {
    const all = (n: ServerName) => JSON.stringify(config.servers[n].env);
    expect(all("gmail")).not.toMatch(/ksecret|krefresh|ghtoken|fkey|llmkey|admin-key/);
    expect(all("kakao")).not.toMatch(/gsecret|ghtoken|fkey|llmkey|admin-key/);
    expect(all("github")).not.toMatch(/gsecret|ksecret|fkey|llmkey|admin-key/);
    expect(all("folio")).not.toMatch(/gsecret|ksecret|ghtoken|llmkey|admin-key/);
    expect(all("todo")).not.toMatch(/gsecret|ksecret|ghtoken|fkey|llmkey|admin-key/);
    for (const n of Object.keys(config.servers) as ServerName[]) expect(all(n)).not.toContain("UNRELATED");
  });

  it("a variable that is not set is simply absent (no empty strings invented)", () => {
    const sparse = loadConfig({ PATH: "/usr/bin" }, "/repo");
    expect(sparse.servers.kakao.env).toEqual({ PATH: "/usr/bin", MY_TASK_ENV_FILE: "/repo/.env.local" });
  });
});
