// my-task original code (not derived from upstream).
import { readFileSync } from "node:fs";
import { createLogger } from "@morning-desk/shared";
import { describe, expect, it } from "vitest";
import type { DockerRunner } from "../src/checks/docker";
import { parseTargets } from "../src/config";
import { SERVER_CHECKS_ALLOWED, toServerChecks } from "../src/index";

// 이 모듈은 점검만 한다. 함수를 더하려면 이 목록과 명세를 의도적으로 고친다.
const ALLOWED = ["checkLlm", "checkServices", "listTargets", "summarizeDockerLogs"];

function make() {
  const dockerCalls: (readonly string[])[] = [];
  const docker: DockerRunner = async (args) => {
    dockerCalls.push(args);
    return { code: 0, stdout: "", stderr: "" };
  };
  const fetchCalls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    fetchCalls.push(String(input));
    return new Response("ok");
  }) as typeof fetch;
  const targets = () => parseTargets({ services: [{ name: "web", url: "https://example.com/" }], containers: [{ name: "veloo-app" }] });
  const checks = toServerChecks(createLogger("silent"), { targets, docker, fetchFn, llmApiKey: undefined });
  return { checks, dockerCalls, fetchCalls };
}

describe("the module surface", () => {
  it("exports exactly the allowed functions", () => {
    expect(Object.keys(make().checks).sort()).toEqual(ALLOWED);
    expect([...SERVER_CHECKS_ALLOWED].sort()).toEqual(ALLOWED);
  });

  it("has no function whose name suggests running, restarting, writing or deleting", () => {
    const forbidden = /exec|run|shell|command|cmd|restart|start|stop|kill|reboot|deploy|write|create|update|delete|remove|prune|clear|rm|ssh|chat|generate|complete/i;
    for (const name of ALLOWED) expect(name).not.toMatch(forbidden);
  });

  it("no input takes an address, port, host, command or file path", () => {
    const text = readFileSync(new URL("../src/index.ts", import.meta.url), "utf-8");
    const iface = /export interface ServerChecks \{([\s\S]*?)\n\}/.exec(text)![1]!;
    const fields = [...iface.matchAll(/\{ ([^}]*) \}\)/g)].flatMap((m) => m[1]!.split(";").map((f) => f.trim().split("?")[0]!.split(":")[0]!).filter(Boolean));
    expect(fields.sort()).toEqual(["container", "hours", "lines", "names"]);
    for (const f of fields) expect(f).not.toMatch(/url|addr|host|port|endpoint|command|cmd|args|path|file|dir|socket|key|token/i);
  });
});

describe("names are checked before anything is contacted", () => {
  it("checkServices rejects names that are not configured or not name-shaped, with no docker or network call", async () => {
    for (const names of [["not-configured"], ["web", "x;y"], ["$(id)"], Array.from({ length: 51 }, () => "web")]) {
      const { checks, dockerCalls, fetchCalls } = make();
      await expect(checks.checkServices({ names })).rejects.toMatchObject({ code: "validation_error" });
      expect(dockerCalls).toEqual([]);
      expect(fetchCalls).toEqual([]);
    }
  });

  it("summarizeDockerLogs only accepts a configured container and bounded hours/lines, with no docker call otherwise", async () => {
    for (const input of [{ container: "veloo app" }, { container: "a;id" }, { container: "$(id)" }, { container: "-f" }, { container: "../x" }, { container: "veloo-app", hours: 73 }, { container: "veloo-app", lines: 5001 }]) {
      const { checks, dockerCalls } = make();
      await expect(checks.summarizeDockerLogs(input), JSON.stringify(input)).rejects.toMatchObject({ code: "validation_error" });
      expect(dockerCalls).toEqual([]);
    }
  });
});

describe("README", () => {
  it("the README function table matches the allowed list", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf-8");
    const table = [...readme.matchAll(/^\| `([A-Za-z]+)\(/gm)].map((m) => m[1]).sort();
    expect(table).toEqual(ALLOWED);
  });
});
