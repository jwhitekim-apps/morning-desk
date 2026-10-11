// my-task original code (not derived from upstream).
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 하루치 기록: 다음 날 모델이 "어제와 이어서" 말하는 데 쓴다. */
export interface DayRecord {
  /** 보고한 먼저 할 일. */
  top: string[];
  /** 그날 추가한 태스크(이름). */
  created: string[];
  /** 그날 던진 질문. */
  questions: string[];
}

export interface Memory {
  version: 1;
  /** 이미 처리한 소스 id → 처리한 날짜(YYYY-MM-DD). 오래된 것은 지운다. */
  processed: { mail: Record<string, string>; github: Record<string, string> };
  /** 마지막으로 브리핑을 실제로 보낸 날짜(한국). */
  lastSentDate?: string;
  /** 날짜별 기록(최근 며칠만 남긴다). */
  days: Record<string, DayRecord>;
}

export const emptyMemory = (): Memory => ({ version: 1, processed: { mail: {}, github: {} }, days: {} });

const KEEP_PROCESSED_DAYS = 60;
const KEEP_DAYS = 14;

/** 오래된 기록을 지운다(처리 기록 60일, 날짜별 기록 14일). */
export function prune(memory: Memory, today: string): Memory {
  const cutoff = (days: number) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const keep = (rec: Record<string, string>, days: number) => Object.fromEntries(Object.entries(rec).filter(([, d]) => d >= cutoff(days)));
  return {
    ...memory,
    processed: { mail: keep(memory.processed.mail, KEEP_PROCESSED_DAYS), github: keep(memory.processed.github, KEEP_PROCESSED_DAYS) },
    days: Object.fromEntries(Object.entries(memory.days).filter(([d]) => d >= cutoff(KEEP_DAYS))),
  };
}

/** 로컬 JSON 파일(폴더 700, 파일 600)에 둔다. 외부로 보내지 않고, 사용자가 지우면 기억이 초기화된다. */
export class MemoryStore {
  constructor(private readonly path: string) {}

  load(): Memory {
    if (!existsSync(this.path)) return emptyMemory();
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf-8")) as Partial<Memory>;
      if (raw.version !== 1) return emptyMemory();
      return { ...emptyMemory(), ...raw, processed: { mail: raw.processed?.mail ?? {}, github: raw.processed?.github ?? {} }, days: raw.days ?? {} };
    } catch {
      return emptyMemory(); // 깨진 파일은 기억이 없는 것으로 본다(브리핑은 계속 나간다)
    }
  }

  save(memory: Memory): void {
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    if ((statSync(dir).mode & 0o777) !== 0o700) chmodSync(dir, 0o700);
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(memory, null, 2), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }
}
