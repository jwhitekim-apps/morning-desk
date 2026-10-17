// my-task original code (not derived from upstream).
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Node 20은 .ts를 직접 실행하지 못하므로 vitest에 딸린 vite-node로 자식 프로세스를 띄운다.
const VITE_NODE = createRequire(import.meta.url).resolve("vite-node/vite-node.mjs");
const WRITER = fileURLToPath(new URL("./fixtures/env-writer.mjs", import.meta.url));

const OTHER = ["# 정리된 설정", "GMAIL_CLIENT_ID=abc", "", "# 큰 줄", `PADDING=${"p".repeat(200_000)}`, ""].join("\n");

function tmpFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), "env-conc-")), ".env.local");
  writeFileSync(path, OTHER, { mode: 0o600 });
  return path;
}

function run(args: string[]): { done: Promise<number | null>; kill: () => void } {
  const child = spawn(process.execPath, [VITE_NODE, WRITER, ...args], { stdio: ["ignore", "ignore", "inherit"] });
  return {
    done: new Promise((resolve) => child.on("exit", (code) => resolve(code))),
    kill: () => child.kill("SIGKILL"),
  };
}

/** 다른 줄은 그대로이고, 각 키는 한 줄씩 `KEY-<n>` 값으로만 있다. */
function expectIntact(path: string, keys: string[]): Map<string, number> {
  const text = readFileSync(path, "utf-8");
  expect(text.startsWith(OTHER)).toBe(true);
  const found = new Map<string, number>();
  for (const line of text.slice(OTHER.length).split("\n")) {
    const m = /^([A-Z]+)=\1-(\d+)$/.exec(line);
    if (!m) continue;
    expect(found.has(m[1] as string)).toBe(false);
    found.set(m[1] as string, Number(m[2]));
  }
  for (const key of keys) expect(found.has(key)).toBe(true);
  return found;
}

describe("env-file: 여러 프로세스", () => {
  it("두 프로세스가 다른 키를 100번씩 번갈아 써도 두 값 모두 마지막 값이다", async () => {
    const path = tmpFile();
    const a = run([path, "AAA", "100"]);
    const b = run([path, "BBB", "100"]);
    expect(await Promise.all([a.done, b.done])).toEqual([0, 0]);
    const found = expectIntact(path, ["AAA", "BBB"]);
    expect(found.get("AAA")).toBe(99);
    expect(found.get("BBB")).toBe(99);
  }, 60_000);

  it("쓰는 도중 죽여도 파일은 완전한 이전 내용이나 새 내용이다", async () => {
    const path = tmpFile();
    const first = run([path, "AAA", "1"]);
    expect(await first.done).toBe(0);
    for (let round = 0; round < 10; round++) {
      // 오래된 잠금은 바로 지우게 해서, 죽은 프로세스가 남긴 잠금이 다음 회차를 막지 않게 한다.
      const writer = run([path, "AAA", "0", "50"]);
      await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));
      writer.kill();
      await writer.done;
      expectIntact(path, ["AAA"]);
    }
  }, 60_000);
});
