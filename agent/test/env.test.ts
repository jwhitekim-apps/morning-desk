// my-task original code (not derived from upstream).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadEnvFile } from "../src/env";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "agent-env-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("loadEnvFile", () => {
  it("reads KEY=VALUE lines, ignores comments and blanks, strips quotes", () => {
    const p = join(dir, ".env.local");
    writeFileSync(p, ["# comment", "", "A=1", 'B="two words"', "C='x'", "  D = spaced  ", "NOT A LINE", "E="].join("\n"));
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(p, env);
    expect(env).toEqual({ A: "1", B: "two words", C: "x", D: "spaced", E: "" });
  });

  it("does not override variables that are already set", () => {
    const p = join(dir, ".env.local");
    writeFileSync(p, "A=from-file\nB=from-file\n");
    const env: NodeJS.ProcessEnv = { A: "from-env" };
    loadEnvFile(p, env);
    expect(env).toEqual({ A: "from-env", B: "from-file" });
  });

  it("a missing file is not an error", () => {
    const env: NodeJS.ProcessEnv = {};
    expect(() => loadEnvFile(join(dir, "nope"), env)).not.toThrow();
    expect(env).toEqual({});
  });

  it("a commented-out assignment is ignored", () => {
    const p = join(dir, ".env.local");
    writeFileSync(p, "#KEY=secret\n");
    const env: NodeJS.ProcessEnv = {};
    loadEnvFile(p, env);
    expect(env.KEY).toBeUndefined();
  });
});
