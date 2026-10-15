// my-task original code (not derived from upstream).
// 이 파일은 mcp/microsoft-todo, gmail, kakao 와 agent 의 src/env-file.ts 에 같은 내용으로 있다.
// 한 곳을 고치면 네 곳 모두 고친다(mcp/microsoft-todo/test/env-file-same.test.ts 가 지킨다).
import { randomBytes } from "node:crypto";
import { open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** 키가 없을 때 새 줄을 더하는 구역의 머리 주석. */
export const TOKEN_SECTION_HEADER = "# --- 토큰 (자동 갱신, 직접 고치지 마세요)";

/** 값은 담지 않는다. 키 이름과 이유만 있다. */
export class EnvFileError extends Error {
  readonly key: string;
  constructor(key: string, reason: string) {
    super(`.env.local ${key}: ${reason}`);
    this.name = "EnvFileError";
    this.key = key;
  }
}

export interface EnvFileOptions {
  /** 이 서버가 다룰 수 있는 키. 목록 밖의 키는 파일을 열기 전에 거부한다. */
  keys: readonly string[];
  /** 파일 경로. 없으면 `resolveEnvFilePath()`. */
  path?: string;
  /** 잠금을 기다리는 최대 시간(ms). */
  lockTimeoutMs?: number;
  /** 이보다 오래된 잠금은 죽은 프로세스의 것으로 보고 지운다(ms). */
  staleLockMs?: number;
}

export interface EnvFile {
  readonly path: string;
  /** 값이 없거나 파일이 없으면 undefined. */
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * `MY_TASK_ENV_FILE`이 있으면 그 경로, 없으면 실행 중인 서버 파일(`mcp/<서버>/dist/index.js`)에서
 * 세 단계 위인 저장소 루트의 `.env.local`.
 */
export function resolveEnvFilePath(env: NodeJS.ProcessEnv = process.env, entry: string | undefined = process.argv[1]): string {
  const configured = env.MY_TASK_ENV_FILE?.trim();
  if (configured) return resolve(configured);
  if (!entry) throw new EnvFileError("MY_TASK_ENV_FILE", "파일 위치를 정할 수 없습니다");
  return join(dirname(resolve(entry)), "..", "..", "..", ".env.local");
}

export function openEnvFile(options: EnvFileOptions): EnvFile {
  const allowed = new Set(options.keys);
  const path = options.path ?? resolveEnvFilePath();
  const lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
  const staleLockMs = options.staleLockMs ?? 30_000;

  const check = (key: string): void => {
    if (!allowed.has(key)) throw new EnvFileError(key, "이 서버가 다룰 수 없는 키입니다");
  };

  const write = async (key: string, edit: (lines: string[]) => string[]): Promise<void> => {
    const release = await lock(path, key, lockTimeoutMs, staleLockMs);
    try {
      const before = await readText(path, key);
      const after = edit(splitLines(before)).join("");
      if (after === before) return;
      await replaceFile(path, key, after);
    } finally {
      await release();
    }
  };

  return {
    path,
    async get(key) {
      check(key);
      const text = await readText(path, key);
      for (const line of splitLines(text)) {
        const value = valueOf(line, key);
        if (value !== undefined) return value === "" ? undefined : value;
      }
      return undefined;
    },
    async set(key, value) {
      check(key);
      if (/[\r\n]/.test(value)) throw new EnvFileError(key, "값에 줄바꿈을 넣을 수 없습니다");
      if (value === "") throw new EnvFileError(key, "빈 값은 쓸 수 없습니다(지우려면 delete)");
      await write(key, (lines) => setLine(lines, key, value));
    },
    async delete(key) {
      check(key);
      await write(key, (lines) => lines.filter((line) => valueOf(line, key) === undefined));
    },
  };
}

/** 줄바꿈 문자를 붙인 채로 나눈다(합치면 원래 글자 그대로). */
function splitLines(text: string): string[] {
  return text === "" ? [] : text.split(/(?<=\n)/);
}

/** 비서의 `.env` 읽기와 같은 규칙: 앞뒤 공백 무시, 감싼 따옴표 제거, 주석 줄 제외. */
function valueOf(line: string, key: string): string | undefined {
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (!m || m[1] !== key) return undefined;
  const value = m[2] as string;
  return /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
}

function setLine(lines: string[], key: string, value: string): string[] {
  const out: string[] = [];
  let replaced = false;
  for (const line of lines) {
    if (valueOf(line, key) === undefined) {
      out.push(line);
    } else if (!replaced) {
      const eol = /\r?\n$/.exec(line)?.[0] ?? "";
      out.push(`${key}=${value}${eol}`);
      replaced = true;
    }
    // 같은 키의 두 번째 줄부터는 버린다(어느 값이 맞는지 모호하므로 하나로 정리).
  }
  if (replaced) return out;

  const last = out.at(-1);
  if (last !== undefined && !last.endsWith("\n")) out[out.length - 1] = `${last}\n`;
  if (!out.some((line) => line.trimEnd() === TOKEN_SECTION_HEADER)) {
    if (out.length > 0 && out.at(-1)?.trim() !== "") out.push("\n");
    out.push(`${TOKEN_SECTION_HEADER}\n`);
  }
  out.push(`${key}=${value}\n`);
  return out;
}

async function readText(path: string, key: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    if (code(err) === "ENOENT") return "";
    throw new EnvFileError(key, `읽기 실패(${code(err) ?? "unknown"})`);
  }
}

/** 같은 폴더의 임시 파일(600)에 쓰고 바꿔치기한다. 읽는 쪽은 언제나 완전한 파일을 본다. */
async function replaceFile(path: string, key: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    const fh = await open(tmp, "wx", 0o600);
    try {
      await fh.chmod(0o600);
      await fh.writeFile(text, "utf-8");
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw new EnvFileError(key, `쓰기 실패(${code(err) ?? "unknown"})`);
  }
}

async function lock(path: string, key: string, timeoutMs: number, staleMs: number): Promise<() => Promise<void>> {
  const lockPath = `${path}.lock`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const fh = await open(lockPath, "wx", 0o600);
      await fh.writeFile(String(process.pid));
      await fh.close();
      return () => unlink(lockPath).catch(() => {});
    } catch (err) {
      if (code(err) !== "EEXIST") throw new EnvFileError(key, `잠금 실패(${code(err) ?? "unknown"})`);
    }
    const age = await stat(lockPath).then((s) => Date.now() - s.mtimeMs, () => 0);
    if (age > staleMs) {
      await unlink(lockPath).catch(() => {});
      continue;
    }
    if (Date.now() > deadline) throw new EnvFileError(key, "잠금을 기다리다 시간이 지났습니다");
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
  }
}

function code(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}
