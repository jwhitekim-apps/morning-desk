// my-task original code (not derived from upstream).
import * as childProcess from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@morning-desk/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryStore } from "../src/memory";
import { createModules } from "../src/modules";
import { run } from "../src/run";

// 자식 프로세스를 띄우는 모든 함수를 감시한다(원래 동작은 그대로).
vi.mock("node:child_process", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:child_process")>();
  const spy = <F extends (...a: never[]) => unknown>(f: F) => vi.fn(f);
  return { ...real, spawn: spy(real.spawn), spawnSync: spy(real.spawnSync), exec: spy(real.exec), execSync: spy(real.execSync), execFile: spy(real.execFile), execFileSync: spy(real.execFileSync), fork: spy(real.fork) };
});

const STARTERS = ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const;
const started = () => STARTERS.reduce((n, name) => n + (childProcess[name] as unknown as { mock: { calls: unknown[] } }).mock.calls.length, 0);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "morning-desk-noproc-"));
  writeFileSync(join(dir, ".env.local"), "", { mode: 0o600 });
  for (const name of STARTERS) (childProcess[name] as unknown as { mockClear(): void }).mockClear();
  // 네트워크로 나가는 일도 없어야 한다(설정이 없으니 모듈은 요청 전에 실패한다).
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in this test"); }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(dir, { recursive: true, force: true });
});

describe("a daily run starts no child process", () => {
  it("runs with the real modules in one process (dry run, nothing configured)", async () => {
    const logger = createLogger("silent");
    const sources = createModules({ MY_TASK_ENV_FILE: join(dir, ".env.local") }, dir, logger);
    const r = await run({ sources, model: null, memory: new MemoryStore(join(dir, "memory.json")), logger }, { dryRun: true, now: new Date("2026-10-11T22:00:00Z") });
    expect(r.status).toBe("dry-run");
    expect(r.failures.length).toBeGreaterThan(0); // 로그인·설정이 없으니 실패가 드러난다
    expect(started()).toBe(0);
  });

  it("the watch itself works: starting a child process is counted", async () => {
    await new Promise((resolve) => childProcess.execFile(process.execPath, ["-e", ""], resolve));
    expect(started()).toBe(1);
  });
});
