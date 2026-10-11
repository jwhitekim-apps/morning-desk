// my-task original code (not derived from upstream).
import { openEnvFile, type EnvFile } from "../env-file";

export const SESSION_KEY = "VELOO_SESSION";

/** 세션 쿠키(`access_token=...`)를 루트 `.env.local`의 `VELOO_SESSION` 줄에 둔다. */
export class SessionStore {
  private readonly file: EnvFile;

  constructor(path: string) {
    this.file = openEnvFile({ keys: [SESSION_KEY], path });
  }

  async read(): Promise<string | null> {
    const v = await this.file.get(SESSION_KEY);
    // 모양이 다른 값은 세션이 없는 것으로 보고 다시 로그인한다.
    return v?.startsWith("access_token=") ? v : null;
  }

  async write(cookie: string): Promise<void> {
    await this.file.set(SESSION_KEY, cookie);
  }

  async clear(): Promise<void> {
    await this.file.delete(SESSION_KEY);
  }
}
