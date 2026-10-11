// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allTools } from "../src/tools/registry";

// 이 서버는 점검만 한다. 새 도구를 추가하려면 이 목록을 의도적으로 고쳐야 한다.
const ALLOWED = ["check_llm", "check_services", "list_targets", "summarize_docker_logs"];

describe("tool registry", () => {
  it("exposes exactly the allowed tool surface", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(ALLOWED);
  });

  it("has no tool whose name suggests running, restarting, writing or deleting", () => {
    const forbidden = /exec|run|shell|command|cmd|restart|start|stop|kill|reboot|deploy|write|create|update|delete|remove|prune|clear|rm|ssh|chat|generate|complete/i;
    for (const tool of allTools) expect(tool.name, tool.name).not.toMatch(forbidden);
  });

  it("every tool is read risk (there is no write or exec class at all)", () => {
    for (const tool of allTools) expect(tool.risk, tool.name).toBe("read");
  });

  it("has unique names and complete definitions", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of allTools) expect(tool.description.length).toBeGreaterThan(0);
  });

  it("no input field takes an address, port, host, command or file path", () => {
    for (const tool of allTools) {
      for (const field of Object.keys(tool.inputShape)) expect(field, `${tool.name}.${field}`).not.toMatch(/url|addr|host|port|endpoint|command|cmd|args|path|file|dir|socket|key|token/i);
    }
  });

  it("container and target names only accept the configured-name shape (no spaces or shell characters)", () => {
    const logs = allTools.find((t) => t.name === "summarize_docker_logs")!;
    const schema = z.object(logs.inputShape);
    expect(schema.safeParse({ container: "veloo-app" }).success).toBe(true);
    for (const bad of ["veloo app", "a;id", "$(id)", "-f", "../x", "a|b"]) expect(schema.safeParse({ container: bad }).success, bad).toBe(false);
    expect(schema.safeParse({ container: "veloo-app", hours: 73 }).success).toBe(false);
    expect(schema.safeParse({ container: "veloo-app", lines: 5001 }).success).toBe(false);
    const services = z.object(allTools.find((t) => t.name === "check_services")!.inputShape);
    expect(services.safeParse({ names: ["veloo", "x;y"] }).success).toBe(false);
  });
});

describe("README", () => {
  it("the README tool table matches the allowed tool list", async () => {
    const { readFileSync } = await import("node:fs");
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    const table = [...readme.matchAll(/^\| `([a-z_]+)` \| 읽기 \|/gm)].map((m) => m[1]).sort();
    expect(table).toEqual(ALLOWED);
  });
});
