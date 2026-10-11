// my-task original code (not derived from upstream).
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TokenCacheContext } from "@azure/msal-node";
import { describe, expect, it } from "vitest";
import { TOKEN_CACHE_KEY, clearCache, envCachePlugin, openTokenEnv } from "../src/auth/token-cache";

const CACHE = JSON.stringify({ RefreshToken: { k: { secret: "refresh-secret-xyz" } } }, null, 2);
const BASE = "# 설정\nGMAIL_CLIENT_ID=abc\n\nKAKAO_REFRESH_TOKEN=kk\n";

function setup(content = BASE) {
  const path = join(mkdtempSync(join(tmpdir(), "todo-cache-")), ".env.local");
  writeFileSync(path, content, { mode: 0o600 });
  return { path, file: openTokenEnv(path) };
}

function ctx(changed: boolean, serialized = CACHE) {
  const seen: string[] = [];
  const c = {
    cacheHasChanged: changed,
    tokenCache: {
      serialize: () => serialized,
      deserialize: (data: string) => {
        JSON.parse(data);
        seen.push(data);
      },
    },
  } as unknown as TokenCacheContext;
  return { c, seen };
}

describe("To Do 토큰 캐시(.env.local)", () => {
  it("캐시가 바뀌면 그 줄만 생기고, 다시 읽으면 같은 캐시다", async () => {
    const { path, file } = setup();
    const plugin = envCachePlugin(file);
    await plugin.afterCacheAccess(ctx(true).c);
    const text = readFileSync(path, "utf-8");
    expect(text.startsWith(BASE)).toBe(true);
    const lines = text.slice(BASE.length).split("\n").filter((l) => l.startsWith(`${TOKEN_CACHE_KEY}=`));
    expect(lines).toHaveLength(1);
    expect(text).not.toContain("refresh-secret-xyz");

    const { c, seen } = ctx(false);
    await plugin.beforeCacheAccess(c);
    expect(seen).toEqual([CACHE]);
  });

  it("바뀌지 않았으면 쓰지 않는다", async () => {
    const { path, file } = setup();
    await envCachePlugin(file).afterCacheAccess(ctx(false).c);
    expect(readFileSync(path, "utf-8")).toBe(BASE);
  });

  it("깨진 값은 빈 캐시로 시작한다", async () => {
    const { file } = setup(`${BASE}${TOKEN_CACHE_KEY}=@@not-base64-json@@\n`);
    const { c, seen } = ctx(false);
    await expect(envCachePlugin(file).beforeCacheAccess(c)).resolves.toBeUndefined();
    expect(seen).toEqual([]);
  });

  it("logout은 그 줄만 지운다", async () => {
    const { path, file } = setup();
    await envCachePlugin(file).afterCacheAccess(ctx(true).c);
    await clearCache(file);
    expect(readFileSync(path, "utf-8")).toBe(`${BASE}\n# --- 토큰 (자동 갱신, 직접 고치지 마세요)\n`);
  });

  it("다른 키는 이 서버에서 다룰 수 없다", async () => {
    const { file } = setup();
    await expect(file.get("KAKAO_REFRESH_TOKEN")).rejects.toThrow("다룰 수 없는 키");
  });
});
