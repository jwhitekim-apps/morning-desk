// my-task original code (not derived from upstream).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** 세션 쿠키(`access_token=...`)를 파일에 저장한다. 폴더 700, 파일 600, 임시 파일에 쓴 뒤 이름을 바꾼다. */
export class SessionStore {
  constructor(private readonly path: string) {}

  read(): string | null {
    if (!existsSync(this.path)) return null;
    try {
      const v = (JSON.parse(readFileSync(this.path, "utf-8")) as { cookie?: unknown }).cookie;
      return typeof v === "string" && v.startsWith("access_token=") ? v : null;
    } catch {
      return null; // 깨진 파일은 세션이 없는 것으로 보고 다시 로그인한다
    }
  }

  write(cookie: string): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: DIR_MODE });
    if ((statSync(dir).mode & 0o777) !== DIR_MODE) chmodSync(dir, DIR_MODE);
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ cookie, saved_at: new Date().toISOString() }, null, 2), { mode: FILE_MODE });
    chmodSync(tmp, FILE_MODE);
    renameSync(tmp, this.path);
  }

  clear(): void {
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}
