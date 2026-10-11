// my-task original code (not derived from upstream).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateTokens } from "../src/migrate";

const CACHE = JSON.stringify({ RefreshToken: { k: { secret: "TODO-SECRET" } } }, null, 2);
const SECRETS = ["TODO-SECRET", "GMAIL-SECRET", "KAKAO-SECRET"];
const ORIGINAL = "# 정리된 설정\nGMAIL_CLIENT_ID=cid\n\n# 카카오\nKAKAO_REST_API_KEY=k\nKAKAO_REFRESH_TOKEN=old-start-value\n";

let root: string;
let home: string;
let envPath: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "migrate-"));
  home = join(root, "home");
  envPath = join(root, "repo", ".env.local");
  mkdirSync(join(root, "repo"));
  writeFileSync(envPath, ORIGINAL, { mode: 0o600 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function put(rel: string, content: string): string {
  const p = join(home, ".config", rel);
  mkdirSync(join(p, ".."), { recursive: true, mode: 0o700 });
  writeFileSync(p, content, { mode: 0o600 });
  return p;
}

function putAll() {
  return {
    todo: put("microsoft-todo-mcp/token-cache.json", CACHE),
    gmail: put("my-task/gmail/token.json", JSON.stringify({ refresh_token: "GMAIL-SECRET", scope: "https://www.googleapis.com/auth/gmail.readonly" })),
    kakao: put("my-task-kakao-mcp/token.json", JSON.stringify({ refresh_token: "KAKAO-SECRET", access_token: "x" })),
  };
}

const read = (key: string) => readFileSync(envPath, "utf-8").split("\n").find((l) => l.startsWith(`${key}=`))?.slice(key.length + 1);

describe("migrate-tokens", () => {
  it("세 종류를 옮기고, 원래 파일과 빈 폴더를 지우고, 600 백업을 남긴다", async () => {
    const files = putAll();
    put("my-task/gmail/client.json", "{}");
    const r = await migrateTokens({ envPath, home, dryRun: false, now: new Date("2026-10-11T07:00:00Z") });
    expect(r.ok).toBe(true);

    expect(Buffer.from(read("MS_TODO_TOKEN_CACHE_DATA") ?? "", "base64").toString("utf-8")).toBe(CACHE);
    expect(read("GMAIL_REFRESH_TOKEN")).toBe("GMAIL-SECRET");
    expect(read("KAKAO_REFRESH_TOKEN")).toBe("KAKAO-SECRET");
    // 다른 줄은 그대로(카카오 줄은 제자리에서 값만 바뀜)
    expect(readFileSync(envPath, "utf-8").startsWith(ORIGINAL.replace("old-start-value", "KAKAO-SECRET"))).toBe(true);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);

    for (const p of Object.values(files)) expect(existsSync(p)).toBe(false);
    expect(existsSync(join(home, ".config", "microsoft-todo-mcp"))).toBe(false);
    // client.json이 남은 폴더는 지우지 않고 알린다
    expect(existsSync(join(home, ".config", "my-task", "gmail", "client.json"))).toBe(true);
    expect(r.lines.join("\n")).toContain("client.json");

    const backups = readdirSync(join(root, "repo")).filter((f) => f.startsWith(".env.local.backup-"));
    expect(backups).toEqual([".env.local.backup-20261011-070000"]);
    const backup = join(root, "repo", backups[0] as string);
    expect(readFileSync(backup, "utf-8")).toBe(ORIGINAL);
    expect(statSync(backup).mode & 0o777).toBe(0o600);
  });

  it("출력에 값이 없다", async () => {
    putAll();
    const dry = await migrateTokens({ envPath, home, dryRun: true });
    const real = await migrateTokens({ envPath, home, dryRun: false });
    const out = [...dry.lines, ...real.lines].join("\n");
    for (const s of SECRETS) expect(out).not.toContain(s);
    expect(out).not.toContain(Buffer.from(CACHE).toString("base64").slice(0, 20));
  });

  it("--dry-run은 찾은 파일과 키 이름만 알리고 아무것도 바꾸지 않는다", async () => {
    const files = putAll();
    const r = await migrateTokens({ envPath, home, dryRun: true });
    expect(r.lines.filter((l) => l.includes("드라이런"))).toHaveLength(3);
    expect(r.lines.join("\n")).toContain("MS_TODO_TOKEN_CACHE_DATA");
    expect(readFileSync(envPath, "utf-8")).toBe(ORIGINAL);
    for (const p of Object.values(files)) expect(existsSync(p)).toBe(true);
    expect(readdirSync(join(root, "repo"))).toEqual([".env.local"]);
  });

  it("없는 종류는 건너뛰었다고 알린다", async () => {
    put("my-task/kakao/token.json", JSON.stringify({ refresh_token: "KAKAO-SECRET" }));
    const r = await migrateTokens({ envPath, home, dryRun: false });
    expect(r.ok).toBe(true);
    expect(r.lines.filter((l) => l.includes("건너뜀")).map((l) => l.split(":")[0])).toEqual(["todo", "gmail"]);
    expect(read("KAKAO_REFRESH_TOKEN")).toBe("KAKAO-SECRET");
  });

  it("다시 읽은 값이 다르면 원래 파일을 지우지 않는다", async () => {
    const p = put("my-task-kakao-mcp/token.json", JSON.stringify({ refresh_token: "a" }));
    const liar = { path: envPath, get: async () => "different", set: async () => {}, delete: async () => {} };
    const r = await migrateTokens({ envPath, home, dryRun: false, file: liar });
    expect(r.ok).toBe(false);
    expect(existsSync(p)).toBe(true);
    expect(r.lines.join("\n")).toContain("원래 파일을 지우지 않음");
  });

  it("백업을 만들 수 없으면 아무것도 옮기지 않는다", async () => {
    const p = put("my-task-kakao-mcp/token.json", JSON.stringify({ refresh_token: "a" }));
    const { chmodSync } = await import("node:fs");
    chmodSync(join(root, "repo"), 0o500);
    try {
      const r = await migrateTokens({ envPath, home, dryRun: false });
      expect(r.ok).toBe(false);
      expect(existsSync(p)).toBe(true);
      expect(readFileSync(envPath, "utf-8")).toBe(ORIGINAL);
    } finally {
      chmodSync(join(root, "repo"), 0o700);
    }
  });

  it("쓸 수 없는 파일(깨진 JSON, 읽기 전용이 아닌 Gmail 권한)은 지우지 않고 실패로 알린다", async () => {
    const bad = put("my-task/todo/token-cache.json", "{broken");
    const wide = put("my-task/gmail/token.json", JSON.stringify({ refresh_token: "GMAIL-SECRET", scope: "https://mail.google.com/" }));
    const r = await migrateTokens({ envPath, home, dryRun: false });
    expect(r.ok).toBe(false);
    expect(existsSync(bad)).toBe(true);
    expect(existsSync(wide)).toBe(true);
    expect(readFileSync(envPath, "utf-8")).toBe(ORIGINAL);
  });

  it("같은 종류가 두 곳에 있으면 옮기지 않는다", async () => {
    const a = put("my-task-kakao-mcp/token.json", JSON.stringify({ refresh_token: "A" }));
    const b = put("my-task/kakao/token.json", JSON.stringify({ refresh_token: "B" }));
    const r = await migrateTokens({ envPath, home, dryRun: false });
    expect(r.ok).toBe(false);
    expect(existsSync(a) && existsSync(b)).toBe(true);
    expect(read("KAKAO_REFRESH_TOKEN")).toBe("old-start-value");
  });
});
