// my-task original code (not derived from upstream).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 네 서버와, 토큰을 옮기는 비서(`migrate-tokens`)가 같은 파일을 쓴다.
const COPIES = ["mcp/gmail", "mcp/kakao", "mcp/veloo", "agent"];
const read = (pkg: string): string =>
  readFileSync(fileURLToPath(new URL(`../../../${pkg}/src/env-file.ts`, import.meta.url)), "utf-8");

describe("env-file.ts는 네 서버와 비서에서 같다", () => {
  it.each(COPIES)("%s", (pkg) => {
    expect(read(pkg) === read("mcp/microsoft-todo")).toBe(true);
  });
});
