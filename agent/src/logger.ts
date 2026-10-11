// my-task original code (not derived from upstream).
/**
 * 구조화 로거. JSON 한 줄을 **stderr**로 쓴다(stdout은 MCP 프로토콜 전용).
 *
 * 개인정보 원칙: 민감한 키를 "가리는" 방식이 아니라 **허용한 필드만 남기는** 방식이다.
 * 허용 목록에 없는 필드는 값이 무엇이든 버려지므로, 메일 제목·본문·토큰이 실수로 넘어와도 기록되지 않는다.
 * 허용 필드는 모두 숫자나 짧은 분류 값이다.
 */
export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const ORDER: Record<LogLevel, number> = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const LEVELS = new Set<string>(["silent", "error", "warn", "info", "debug"]);

export interface LogFields {
  tool?: string;
  op?: string;
  durationMs?: number;
  status?: number;
  count?: number;
  server?: string;
  step?: string;
  attempt?: number;
  waitMs?: number;
  truncated?: boolean;
  outcome?: "ok" | "error";
  errorCode?: string;
  version?: string;
  registeredTools?: number;
}

const ALLOWED = new Set<string>([
  "tool", "op", "durationMs", "status", "count", "server", "step", "attempt", "waitMs", "truncated", "outcome", "errorCode", "version", "registeredTools",
]);

/** 허용 필드 중에서도 숫자·불리언·짧은 문자열만 통과시킨다. */
function keep(fields: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED.has(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.length <= 40) out[key] = value;
  }
  return out;
}

export class Logger {
  constructor(
    private readonly level: LogLevel,
    private readonly base: LogFields = {},
    private readonly sink: (line: string) => void = (line) => process.stderr.write(line),
  ) {}

  child(fields: LogFields): Logger {
    return new Logger(this.level, { ...this.base, ...fields }, this.sink);
  }

  error(msg: string, fields?: LogFields): void { this.write("error", msg, fields); }
  warn(msg: string, fields?: LogFields): void { this.write("warn", msg, fields); }
  info(msg: string, fields?: LogFields): void { this.write("info", msg, fields); }
  debug(msg: string, fields?: LogFields): void { this.write("debug", msg, fields); }

  private write(level: Exclude<LogLevel, "silent">, msg: string, fields: LogFields = {}): void {
    if (ORDER[level] > ORDER[this.level]) return;
    this.sink(JSON.stringify({ level, time: new Date().toISOString(), msg, ...keep({ ...this.base, ...fields }) }) + "\n");
  }
}

export function createLogger(level: string | undefined, sink?: (line: string) => void): Logger {
  const lvl = (level && LEVELS.has(level) ? level : "info") as LogLevel;
  return new Logger(lvl, {}, sink);
}
