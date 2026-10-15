// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import { openEnvFile, type EnvFile } from "@morning-desk/shared";

export const REFRESH_TOKEN_KEY = "GMAIL_REFRESH_TOKEN";

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** 갱신 토큰만 루트 `.env.local`의 `GMAIL_REFRESH_TOKEN` 줄에 둔다. 액세스 토큰은 저장하지 않는다(메모리에만). */
export class TokenStore {
  private readonly file: EnvFile;

  constructor(path: string) {
    this.file = openEnvFile({ keys: [REFRESH_TOKEN_KEY], path });
  }

  async read(): Promise<string | null> {
    return (await this.file.get(REFRESH_TOKEN_KEY)) ?? null;
  }

  async write(refreshToken: string): Promise<void> {
    await this.file.set(REFRESH_TOKEN_KEY, refreshToken);
  }

  async clear(): Promise<void> {
    await this.file.delete(REFRESH_TOKEN_KEY);
  }
}

/** OAuth 클라이언트(앱 등록 정보)는 `.env.local`의 `GMAIL_CLIENT_ID`·`GMAIL_CLIENT_SECRET`에서만 읽는다. */
export function loadOAuthClient(opts: { clientId?: string; clientSecret?: string }): OAuthClient {
  if (opts.clientId && opts.clientSecret) return { clientId: opts.clientId, clientSecret: opts.clientSecret };
  throw new AppError("config_error", "No OAuth client configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env.local (see README).");
}
