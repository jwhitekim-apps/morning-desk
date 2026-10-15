// my-task original code (not derived from upstream).
import { mkdtempSync, readFileSync, statSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EnvFileError, TOKEN_SECTION_HEADER, openEnvFile, resolveEnvFilePath } from "../src/env-file";

const SECRET = "super-secret-value-123";

function tmpFile(content?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "env-file-"));
  const path = join(dir, ".env.local");
  if (content !== undefined) writeFileSync(path, content, { mode: 0o600 });
  return path;
}

const ORGANIZED = [
  "# Gmail",
  "GMAIL_CLIENT_ID=abc",
  "GMAIL_CLIENT_SECRET = 'quoted' ",
  "",
  "# 카카오\r",
  "KAKAO_REST_API_KEY=k1",
  "KAKAO_REFRESH_TOKEN=old",
  "",
  "# GitHub",
  "GITHUB_TOKEN=gh",
  "",
].join("\n");

describe("env-file", () => {
  it("한 키의 값만 바꾸고 다른 줄·주석·빈 줄·순서·줄바꿈은 그대로 둔다", async () => {
    const path = tmpFile(ORGANIZED);
    await openEnvFile({ keys: ["KAKAO_REFRESH_TOKEN"], path }).set("KAKAO_REFRESH_TOKEN", "new");
    expect(readFileSync(path, "utf-8")).toBe(ORGANIZED.replace("KAKAO_REFRESH_TOKEN=old", "KAKAO_REFRESH_TOKEN=new"));
  });

  it("키가 없으면 토큰 구역을 만들어 끝에 더하고, 다음 키는 같은 구역에 더한다", async () => {
    const path = tmpFile("A=1");
    const file = openEnvFile({ keys: ["X", "Y"], path });
    await file.set("X", "x1");
    await file.set("Y", "y1");
    expect(readFileSync(path, "utf-8")).toBe(`A=1\n\n${TOKEN_SECTION_HEADER}\nX=x1\nY=y1\n`);
  });

  it("파일이 없으면 새로 만든다", async () => {
    const path = tmpFile();
    await openEnvFile({ keys: ["X"], path }).set("X", "x1");
    expect(readFileSync(path, "utf-8")).toBe(`${TOKEN_SECTION_HEADER}\nX=x1\n`);
  });

  it("같은 키가 둘이면 첫 줄을 바꾸고 나머지는 지운다", async () => {
    const path = tmpFile("X=a\nB=2\nX=b\n");
    await openEnvFile({ keys: ["X"], path }).set("X", "c");
    expect(readFileSync(path, "utf-8")).toBe("X=c\nB=2\n");
  });

  it("읽기: 비서와 같은 규칙(공백·따옴표), 주석 줄과 빈 값은 없는 것으로 본다", async () => {
    const path = tmpFile("# X=commented\nX = 'v1' \nE=\n");
    const file = openEnvFile({ keys: ["X", "E", "MISSING"], path });
    expect(await file.get("X")).toBe("v1");
    expect(await file.get("E")).toBeUndefined();
    expect(await file.get("MISSING")).toBeUndefined();
    expect(await openEnvFile({ keys: ["X"], path: tmpFile() }).get("X")).toBeUndefined();
  });

  it("지우기는 그 키의 줄만 없앤다", async () => {
    const path = tmpFile(ORGANIZED);
    await openEnvFile({ keys: ["KAKAO_REFRESH_TOKEN"], path }).delete("KAKAO_REFRESH_TOKEN");
    expect(readFileSync(path, "utf-8")).toBe(ORGANIZED.replace("KAKAO_REFRESH_TOKEN=old\n", ""));
  });

  it("목록 밖 키는 파일을 열기 전에 오류가 난다", async () => {
    // 경로가 디렉터리라 열면 다른 오류가 나므로, 키 검사가 먼저임을 알 수 있다.
    const file = openEnvFile({ keys: ["MINE"], path: tmpdir() });
    for (const op of [() => file.get("OTHER"), () => file.set("OTHER", "v"), () => file.delete("OTHER")]) {
      const err = await op().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EnvFileError);
      expect((err as Error).message).toContain("다룰 수 없는 키");
    }
  });

  it("쓴 뒤 권한은 600이고, 임시·잠금 파일이 남지 않는다", async () => {
    const path = tmpFile("A=1\n");
    const { chmodSync } = await import("node:fs");
    chmodSync(path, 0o644);
    await openEnvFile({ keys: ["X"], path }).set("X", "v");
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readdirSync(join(path, ".."))).toEqual([".env.local"]);
  });

  it("오류 메시지에 값이 들어가지 않는다", async () => {
    const file = openEnvFile({ keys: ["X"], path: join(tmpdir(), "no-such-dir-xyz", ".env.local") });
    const errs = await Promise.all([
      file.set("X", SECRET).catch((e: unknown) => e),
      file.set("X", `${SECRET}\nINJECTED=1`).catch((e: unknown) => e),
    ]);
    for (const err of errs) {
      expect(err).toBeInstanceOf(EnvFileError);
      expect(String((err as Error).message) + String((err as Error).stack)).not.toContain(SECRET);
    }
  });

  it("오래된 잠금은 지우고, 살아 있는 잠금은 기다리다 시간 초과", async () => {
    const path = tmpFile("A=1\n");
    writeFileSync(`${path}.lock`, "999999");
    const fresh = openEnvFile({ keys: ["X"], path, lockTimeoutMs: 100, staleLockMs: 60_000 });
    await expect(fresh.set("X", "v")).rejects.toThrow("잠금");
    const stale = openEnvFile({ keys: ["X"], path, lockTimeoutMs: 100, staleLockMs: 0 });
    await new Promise((r) => setTimeout(r, 5));
    await stale.set("X", "v");
    expect(await stale.get("X")).toBe("v");
  });

  it("위치: MY_TASK_ENV_FILE이 우선, 없으면 app/dist/index.js에서 두 단계 위", () => {
    expect(resolveEnvFilePath({ MY_TASK_ENV_FILE: "/a/b/.env.local" }, "/x")).toBe("/a/b/.env.local");
    expect(resolveEnvFilePath({}, "/repo/app/dist/index.js")).toBe("/repo/.env.local");
  });
});
