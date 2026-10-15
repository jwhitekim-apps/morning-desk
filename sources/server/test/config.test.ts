// my-task original code (not derived from upstream).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTargets, parseTargets, targetsPath } from "../src/config";

const GOOD = {
  services: [
    { name: "veloo", url: "https://veloo.2joon.com/" },
    { name: "ssh", host: "127.0.0.1", port: 22, timeoutMs: 1000 },
    { name: "dev-api", url: "http://localhost:8000/health" },
  ],
  containers: [{ name: "veloo-app" }, { name: "db_1.main", restartWarn: 5 }],
  llm: { name: "school-llm", baseUrl: "https://pr5.gachon.ac.kr:3389/v1/", models: ["qwen3.6:35b-a3b"] },
};

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return "no error";
};

describe("targets config", () => {
  it("reads a valid config with defaults and plaintext marks", () => {
    const t = parseTargets(GOOD);
    expect(t.services.map((s) => [s.name, s.timeoutMs, s.slowMs, s.plaintext])).toEqual([
      ["veloo", 5000, 2000, false],
      ["ssh", 1000, 2000, false],
      ["dev-api", 5000, 2000, true],
    ]);
    expect(t.containers).toEqual([{ name: "veloo-app", restartWarn: 3 }, { name: "db_1.main", restartWarn: 5 }]);
    expect(t.llm).toMatchObject({ baseUrl: "https://pr5.gachon.ac.kr:3389/v1", host: "pr5.gachon.ac.kr", port: 3389, plaintext: false });
    expect(parseTargets({ llm: { name: "l", baseUrl: "http://x.example/v1", models: ["m"] } }).llm).toMatchObject({ port: 80, plaintext: true });
  });

  it("rejects container names with spaces or shell characters", () => {
    for (const bad of ["veloo app", "a;rm -rf /", "$(id)", "-flag", "a|b", "a`b`", ""]) {
      expect(code(() => parseTargets({ containers: [{ name: bad }] })), bad).toBe("config_error");
    }
  });

  it("rejects values that are not addresses", () => {
    expect(code(() => parseTargets({ services: [{ name: "a", url: "not a url" }] }))).toBe("config_error");
    expect(code(() => parseTargets({ services: [{ name: "a", url: "file:///etc/passwd" }] }))).toBe("config_error");
    expect(code(() => parseTargets({ services: [{ name: "a", host: "a b;c", port: 22 }] }))).toBe("config_error");
    expect(code(() => parseTargets({ services: [{ name: "a", host: "h", port: 70000 }] }))).toBe("config_error");
    expect(code(() => parseTargets({ llm: { name: "l", baseUrl: "ftp://x/v1", models: ["m"] } }))).toBe("config_error");
    expect(code(() => parseTargets({ services: [{ name: "a", url: "https://x", command: "rm" }] }))).toBe("config_error");
  });

  it("no targets at all is config_missing", () => {
    expect(code(() => parseTargets({}))).toBe("config_missing");
    expect(code(() => parseTargets({ services: [], containers: [] }))).toBe("config_missing");
    expect(code(() => loadTargets(join(tmpdir(), "no-such-targets.json")))).toBe("config_missing");
  });

  it("broken JSON and duplicate names are config errors", () => {
    const p = join(mkdtempSync(join(tmpdir(), "targets-")), "targets.json");
    writeFileSync(p, "{oops");
    expect(code(() => loadTargets(p))).toBe("config_error");
    expect(code(() => parseTargets({ services: [{ name: "a", url: "https://x" }, { name: "a", host: "h", port: 1 }] }))).toBe("config_error");
  });

  it("location: SERVER_TARGETS first, otherwise sources/server/targets.json under the repo root", () => {
    expect(targetsPath({ SERVER_TARGETS: "/etc/t.json" }, "/x")).toBe("/etc/t.json");
    expect(targetsPath({}, "/repo")).toBe("/repo/sources/server/targets.json");
    // 옛 이름(SERVER_MCP_TARGETS)은 더 읽지 않는다.
    expect(targetsPath({ SERVER_MCP_TARGETS: "/etc/old.json" }, "/repo")).toBe("/repo/sources/server/targets.json");
  });
});
