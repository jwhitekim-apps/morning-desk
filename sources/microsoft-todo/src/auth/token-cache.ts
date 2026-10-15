// Based on fabienbutz/microsoft-todo-mcp @83d8f44 (https://github.com/fabienbutz/microsoft-todo-mcp)
// Copyright (c) 2026 Fabien Butz, MIT License (see LICENSE).
// Modified for my-task: 캐시를 파일 대신 루트 `.env.local`의 한 줄(base64)에 저장하도록 바꿨다(공용 env-file 사용).
import type { ICachePlugin, TokenCacheContext } from "@azure/msal-node";
import { openEnvFile, type EnvFile } from "@morning-desk/shared";

export const TOKEN_CACHE_KEY = "MS_TODO_TOKEN_CACHE_DATA";

export function openTokenEnv(path: string): EnvFile {
  return openEnvFile({ keys: [TOKEN_CACHE_KEY], path });
}

/**
 * Persists the MSAL token cache (which holds the refresh token) as base64 in one `.env.local`
 * line. A missing line is normal (not yet signed in); a corrupt value is tolerated — we start
 * with an empty cache and the next successful login overwrites it.
 */
export function envCachePlugin(file: EnvFile): ICachePlugin {
  return {
    async beforeCacheAccess(ctx: TokenCacheContext): Promise<void> {
      const encoded = await file.get(TOKEN_CACHE_KEY);
      if (!encoded) return;
      try {
        ctx.tokenCache.deserialize(Buffer.from(encoded, "base64").toString("utf-8"));
      } catch {
        // Corrupt cache — ignore it and start fresh rather than crashing.
      }
    },
    async afterCacheAccess(ctx: TokenCacheContext): Promise<void> {
      if (!ctx.cacheHasChanged) return;
      await file.set(TOKEN_CACHE_KEY, Buffer.from(ctx.tokenCache.serialize(), "utf-8").toString("base64"));
    },
  };
}

export async function clearCache(file: EnvFile): Promise<void> {
  await file.delete(TOKEN_CACHE_KEY);
}
