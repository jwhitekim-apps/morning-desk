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
    expect(secretsOf("gmail")).toEqual(["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "HOME", "PATH"]);
    expect(secretsOf("kakao")).toEqual(["HOME", "KAKAO_CLIENT_SECRET", "KAKAO_LINK_URL", "KAKAO_REFRESH_TOKEN", "KAKAO_REST_API_KEY", "PATH"]);
    expect(secretsOf("github")).toEqual(["GITHUB_MCP_NOTIFICATIONS_TOKEN", "GITHUB_MCP_TOKEN", "HOME", "PATH"]);
    expect(secretsOf("folio")).toEqual(["FOLIO_SUPABASE_KEY", "FOLIO_SUPABASE_URL", "HOME", "PATH"]);
    expect(secretsOf("todo")).toEqual(["HOME", "MS_TODO_CLIENT_ID", "PATH"]);
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
    expect(sparse.servers.kakao.env).toEqual({ PATH: "/usr/bin" });
  });
});
