// my-task original code (not derived from upstream).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { AppError } from "../errors";

/** 저장하는 토큰. 액세스 토큰은 메모리 캐시 대용으로 같이 둔다(만료 시각 포함). */
export interface StoredToken {
  refresh_token: string;
  access_token?: string;
  /** 액세스 토큰 만료 시각(ms, epoch). */
  expires_at?: number;
  scope: string;
  saved_at: string;
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

/** 폴더는 700, 파일은 600으로 만든다. 이미 있는 폴더의 권한이 느슨하면 조인다. */
function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  if ((statSync(dir).mode & 0o777) !== DIR_MODE) chmodSync(dir, DIR_MODE);
}

export class TokenStore {
  constructor(private readonly path: string) {}

  read(): StoredToken | null {
    if (!existsSync(this.path)) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf-8"));
    } catch {
      throw new AppError("auth_required", "The saved token file is unreadable. Run `login` again.");
    }
    const t = parsed as Partial<StoredToken> | null;
    if (!t || typeof t.refresh_token !== "string" || !t.refresh_token) {
      throw new AppError("auth_required", "The saved token file has no refresh token. Run `login` again.");
    }
    return t as StoredToken;
  }

  /** 임시 파일에 600으로 쓴 뒤 바꿔치기해서, 쓰다 끊겨도 반쯤 쓴 파일이 남지 않고 권한이 느슨한 순간도 없다. */
  write(token: StoredToken): void {
    ensureDir(dirname(this.path));
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(token, null, 2), { mode: FILE_MODE });
    chmodSync(tmp, FILE_MODE);
    renameSync(tmp, this.path);
  }

  clear(): void {
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}

/**
 * OAuth 클라이언트(앱 등록 정보)를 환경 변수 또는 `client.json`에서 읽는다.
 * `client.json`은 구글 콘솔에서 내려받은 파일(`{"installed": {...}}`)을 그대로 두면 된다.
 */
export function loadOAuthClient(opts: { clientId?: string; clientSecret?: string; clientPath: string }): OAuthClient {
  if (opts.clientId && opts.clientSecret) return { clientId: opts.clientId, clientSecret: opts.clientSecret };
  if (existsSync(opts.clientPath)) {
    try {
      const raw = JSON.parse(readFileSync(opts.clientPath, "utf-8")) as Record<string, unknown>;
      const body = (raw.installed ?? raw.web ?? raw) as Record<string, unknown>;
      const id = body.client_id;
      const secret = body.client_secret;
      if (typeof id === "string" && typeof secret === "string" && id && secret) return { clientId: id, clientSecret: secret };
    } catch {
      /* 아래 오류로 이어진다 */
    }
    throw new AppError("config_error", `The OAuth client file ${join(opts.clientPath)} could not be read. Put the JSON downloaded from Google Cloud Console there.`);
  }
  throw new AppError("config_error", "No OAuth client configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET, or place the downloaded client JSON at the client.json path (see README).");
}
