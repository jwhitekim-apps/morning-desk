// my-task original code (not derived from upstream).
import { chmod, copyFile, readdir, readFile, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { openEnvFile, type EnvFile } from "./env-file";

const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

/** 옛 토큰 파일 한 종류: 찾을 위치들, 옮길 키, 파일 내용에서 값을 꺼내는 방법. */
interface Kind {
  name: "todo" | "gmail" | "kakao" | "veloo";
  key: string;
  paths: (home: string) => string[];
  /** 값을 꺼낸다. 쓸 수 없는 파일이면 이유를 던진다(값은 넣지 않는다). */
  extract: (text: string) => string;
}

const json = (text: string): Record<string, unknown> => {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("JSON이 아닙니다");
  }
};
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v === "" || /[\r\n]/.test(v)) throw new Error(`${what} 값이 없습니다`);
  return v;
};

export const KINDS: readonly Kind[] = [
  {
    name: "todo",
    key: "MS_TODO_TOKEN_CACHE_DATA",
    paths: (h) => [join(h, ".config", "microsoft-todo-mcp", "token-cache.json"), join(h, ".config", "my-task", "todo", "token-cache.json")],
    extract: (text) => {
      json(text);
      return Buffer.from(text, "utf-8").toString("base64");
    },
  },
  {
    name: "gmail",
    key: "GMAIL_REFRESH_TOKEN",
    paths: (h) => [join(h, ".config", "my-task-gmail-mcp", "token.json"), join(h, ".config", "my-task", "gmail", "token.json")],
    extract: (text) => {
      const t = json(text);
      if (t.scope !== undefined && t.scope !== GMAIL_READONLY_SCOPE) throw new Error("읽기 전용이 아닌 권한입니다");
      return str(t.refresh_token, "refresh_token");
    },
  },
  {
    name: "kakao",
    key: "KAKAO_REFRESH_TOKEN",
    paths: (h) => [join(h, ".config", "my-task-kakao-mcp", "token.json"), join(h, ".config", "my-task", "kakao", "token.json")],
    extract: (text) => str(json(text).refresh_token, "refresh_token"),
  },
  {
    name: "veloo",
    key: "VELOO_SESSION",
    paths: (h) => [join(h, ".config", "my-task-veloo-mcp", "session.json"), join(h, ".config", "my-task", "veloo", "session.json")],
    extract: (text) => {
      const v = str(json(text).cookie, "cookie");
      if (!v.startsWith("access_token=")) throw new Error("세션 모양이 아닙니다");
      return v;
    },
  },
];

export interface MigrateOptions {
  envPath: string;
  home: string;
  dryRun: boolean;
  /** 백업 파일 이름에 붙일 시각. */
  now?: Date;
  /** 시험용: `.env.local` 대신 쓸 저장소. */
  file?: EnvFile;
}

export interface MigrateResult {
  /** 사람에게 보여 줄 줄들. 값은 들어가지 않는다. */
  lines: string[];
  /** 실패가 하나라도 있으면 false. */
  ok: boolean;
}

const exists = (p: string): Promise<boolean> => stat(p).then(() => true, () => false);

/**
 * 홈 폴더의 옛 토큰 파일을 루트 `.env.local`의 정해진 키로 옮긴다.
 * 먼저 `.env.local`을 백업(600)하고, 키를 쓴 뒤 다시 읽어 같을 때만 원래 파일을 지운다(빈 폴더도).
 */
export async function migrateTokens(opts: MigrateOptions): Promise<MigrateResult> {
  const lines: string[] = [];
  let ok = true;
  const file = opts.file ?? openEnvFile({ keys: KINDS.map((k) => k.key), path: opts.envPath });

  const found: { kind: Kind; path: string; value: string }[] = [];
  for (const kind of KINDS) {
    const hits = [];
    for (const p of kind.paths(opts.home)) if (await exists(p)) hits.push(p);
    if (hits.length === 0) {
      lines.push(`${kind.name}: 옛 토큰 파일 없음 (건너뜀)`);
      continue;
    }
    if (hits.length > 1) {
      ok = false;
      lines.push(`${kind.name}: 옛 토큰 파일이 여러 개라 어느 것이 맞는지 모름 (건너뜀): ${hits.join(", ")}`);
      continue;
    }
    const path = hits[0] as string;
    try {
      found.push({ kind, path, value: kind.extract(await readFile(path, "utf-8")) });
    } catch (err) {
      ok = false;
      lines.push(`${kind.name}: ${path} 를 쓸 수 없음 (${err instanceof Error ? err.message : "읽기 실패"}) — 지우지 않음`);
    }
  }

  if (opts.dryRun) {
    for (const f of found) lines.push(`${f.kind.name}: ${f.path} → ${f.kind.key} (드라이런: 옮기지 않음)`);
    return { lines, ok };
  }
  if (found.length === 0) return { lines, ok };

  if (await exists(opts.envPath)) {
    const stamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
    const backup = `${opts.envPath}.backup-${stamp}`;
    try {
      await copyFile(opts.envPath, backup);
      await chmod(backup, 0o600);
    } catch (err) {
      lines.push(`백업 실패 (${(err as NodeJS.ErrnoException).code ?? "오류"}) — 아무것도 옮기지 않음`);
      return { lines, ok: false };
    }
    lines.push(`백업: ${backup}`);
  }

  for (const f of found) {
    try {
      await file.set(f.kind.key, f.value);
      if ((await file.get(f.kind.key)) !== f.value) throw new Error("다시 읽은 값이 다릅니다");
    } catch (err) {
      ok = false;
      lines.push(`${f.kind.name}: ${f.kind.key} 쓰기 확인 실패 (${err instanceof Error ? err.message : "오류"}) — 원래 파일을 지우지 않음`);
      continue;
    }
    await unlink(f.path);
    lines.push(`${f.kind.name}: ${f.path} → ${f.kind.key} (옮기고 원래 파일 삭제)`);
    const dir = dirname(f.path);
    const left = await readdir(dir).catch(() => []);
    if (left.length === 0) await rmdir(dir).catch(() => {});
    else lines.push(`  ${dir} 에 다른 파일이 남아 있어 폴더는 두었음: ${left.join(", ")}`);
  }
  return { lines, ok };
}
