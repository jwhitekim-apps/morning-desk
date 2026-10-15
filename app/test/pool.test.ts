// my-task original code (not derived from upstream).
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { McpPool } from "../src/mcp/pool";
import { createLogger } from "../src/logger";
import type { ServerSpec } from "../src/config";

const FIXTURE = fileURLToPath(new URL("./fixtures/fake-server.mjs", import.meta.url));
const spec = (env: Record<string, string> = {}): ServerSpec => ({ name: "todo", entry: FIXTURE, env: { PATH: process.env.PATH ?? "", ...env } });

const pools: McpPool[] = [];
afterEach(async () => { await Promise.all(pools.splice(0).map((p) => p.close())); });
const make = (specs: ConstructorParameters<typeof McpPool>[0], lines: string[] = []) => {
  const p = new McpPool(specs, createLogger("debug", (l) => lines.push(l)));
  pools.push(p);
  return p;
};

describe("McpPool with a real child-process server", () => {
  it("starts the server and lists its tools", async () => {
    expect(await make({ todo: spec() }).tools("todo")).toEqual(["echo", "fail", "not_json", "slow"]);
  });

  it("calls a tool and parses the JSON answer", async () => {
    const r = (await make({ todo: spec() }).call("todo", "echo", { text: "안녕" })) as { args: { text: string } };
    expect(r.args).toEqual({ text: "안녕" });
  });

  it("reuses one process for several calls", async () => {
    const lines: string[] = [];
    const pool = make({ todo: spec() }, lines);
    await pool.call("todo", "echo");
    await pool.call("todo", "echo");
    expect(lines.filter((l) => l.includes("server started"))).toHaveLength(1);
  });

  it("passes only the given environment to the child (a secret not in the spec never reaches it)", async () => {
    const saved = process.env.FAKE_PARENT_SECRET;
    process.env.FAKE_PARENT_SECRET = "must-not-leak";
    try {
      const r = (await make({ todo: spec({ FAKE_ALLOWED_TOKEN: "ok" }) }).call("todo", "echo")) as { envNames: string[] };
      expect(r.envNames).toEqual(["FAKE_ALLOWED_TOKEN"]);
    } finally {
      if (saved === undefined) delete process.env.FAKE_PARENT_SECRET; else process.env.FAKE_PARENT_SECRET = saved;
    }
  });

  it("a tool error becomes a tool_error that carries the server's code", async () => {
    const err = await make({ todo: spec() }).call("todo", "fail").catch((e: Error) => e);
    expect(err).toMatchObject({ code: "tool_error", toolCode: "auth_expired" });
  });

  it("an answer that is not JSON is a tool_error", async () => {
    await expect(make({ todo: spec() }).call("todo", "not_json")).rejects.toMatchObject({ code: "tool_error" });
  });

  it("a slow tool hits the timeout and says so", async () => {
    await expect(make({ todo: spec() }).call("todo", "slow", { ms: 3000 }, { timeoutMs: 200 })).rejects.toMatchObject({ code: "timeout" });
  });

  it("a server that cannot start is server_unavailable, and an unknown server is a config error", async () => {
    await expect(make({ todo: { name: "todo", entry: "/nonexistent/index.js", env: { PATH: process.env.PATH ?? "" } } }).tools("todo")).rejects.toMatchObject({ code: "server_unavailable" });
    await expect(make({}).tools("gmail")).rejects.toMatchObject({ code: "config_error" });
  });

  it("the log holds the server and tool names and timings, never arguments or answers", async () => {
    const lines: string[] = [];
    await make({ todo: spec() }, lines).call("todo", "echo", { text: "극비 인자 5e1a" });
    const log = lines.join("");
    expect(log).toContain('"server":"todo"');
    expect(log).toMatch(/"durationMs":\d+/);
    expect(log).not.toContain("극비");
  });

  it("close shuts every server down and can be called twice", async () => {
    const pool = make({ todo: spec() });
    await pool.tools("todo");
    await pool.close();
    await expect(pool.close()).resolves.toBeUndefined();
  });
});
