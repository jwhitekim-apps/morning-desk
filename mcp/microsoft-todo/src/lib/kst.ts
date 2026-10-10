// my-task original code (not derived from upstream).
//
// 한국 표준시(KST, UTC+9) 변환. 시간 규칙이 여러 곳에 흩어지면 날짜가 하루 어긋나는 오류가 숨기 때문에 한 곳에 모은다.
//
// 실측(개인 계정): 앱에서 날짜만 고른 마감은 Graph에서 {"dateTime":"2026-04-08T15:00:00.0000000","timeZone":"UTC"}로 온다.
// 한국 자정(4/9 00:00)이 UTC로 표현된 것이어서, 날짜 부분만 잘라 쓰면 하루 전으로 보인다.
import { AppError } from "../graph/errors";

export const KST = "Asia/Seoul";
const KST_OFFSET_MIN = 9 * 60;
const MS_PER_MIN = 60_000;

/** Graph `dateTimeTimeZone`. */
export interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

/** 한국 시간의 날짜("YYYY-MM-DD")와 시각("HH:MM"). */
export interface KstDateTime {
  date: string;
  time: string;
}

export type DateTimeInput = string | { dateTime: string; timeZone?: string };

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?(Z|[+-]\d{2}:?\d{2})?$/;

interface Parts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
  ms: number;
  /** 문자열에 붙은 UTC 오프셋(분). 없으면 null. */
  offsetMin: number | null;
}

function invalid(message: string): never {
  throw new AppError("validation_error", message);
}

function parse(text: string): Parts {
  const m = PATTERN.exec(text.trim());
  if (!m) invalid(`Invalid date-time "${text}". Use YYYY-MM-DD or YYYY-MM-DDTHH:mm[:ss].`);
  const [, y, mo, d, h = "0", mi = "0", s = "0", frac = "", zone] = m;
  const parts: Parts = {
    y: Number(y),
    mo: Number(mo),
    d: Number(d),
    h: Number(h),
    mi: Number(mi),
    s: Number(s),
    ms: frac ? Math.floor(Number(`0.${frac}`) * 1000) : 0,
    offsetMin: zone === undefined ? null : zone === "Z" ? 0 : offsetOf(zone),
  };
  // 존재하지 않는 날짜(13월, 2월 30일, 25시)를 걸러 낸다: 되돌려 봐서 같아야 한다.
  const probe = new Date(Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s));
  if (
    probe.getUTCFullYear() !== parts.y ||
    probe.getUTCMonth() !== parts.mo - 1 ||
    probe.getUTCDate() !== parts.d ||
    probe.getUTCHours() !== parts.h ||
    probe.getUTCMinutes() !== parts.mi ||
    parts.s > 59
  ) {
    invalid(`Invalid date-time "${text}": no such calendar date or time.`);
  }
  return parts;
}

function offsetOf(zone: string): number {
  const sign = zone.startsWith("-") ? -1 : 1;
  const digits = zone.slice(1).replace(":", "");
  return sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4)));
}

/** 그 순간(UTC ms)에 해당 시간대의 UTC 오프셋(분). 모르는 시간대는 추측하지 않고 오류로 알린다. */
function zoneOffsetAt(timeZone: string, utcMs: number): number {
  const zone = timeZone.trim();
  if (/^(UTC|Etc\/UTC|GMT|Etc\/GMT|Z)$/i.test(zone)) return 0;
  if (zone === KST || zone === "Korea Standard Time" || zone === "Asia/Seoul") return KST_OFFSET_MIN;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return invalid(`Unsupported time zone "${timeZone}". Use an IANA name such as Asia/Seoul or UTC.`);
  }
  const get = (type: string) => Number(formatter.formatToParts(new Date(utcMs)).find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / MS_PER_MIN);
}

/** 시간대의 벽시계 시각 → UTC ms. 일광절약 경계에서도 맞도록 오프셋을 두 번 확인한다. */
function wallToUtcMs(parts: Parts, timeZone: string): number {
  const asIfUtc = Date.UTC(parts.y, parts.mo - 1, parts.d, parts.h, parts.mi, parts.s, parts.ms);
  if (parts.offsetMin !== null) return asIfUtc - parts.offsetMin * MS_PER_MIN;
  const first = zoneOffsetAt(timeZone, asIfUtc);
  const guess = asIfUtc - first * MS_PER_MIN;
  const second = zoneOffsetAt(timeZone, guess);
  return second === first ? guess : asIfUtc - second * MS_PER_MIN;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

function formatUtc(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.0000000`;
}

/**
 * 입력을 Graph로 보낼 UTC 형식으로 바꾼다. 앱이 저장하는 모양(예: 한국 자정 = 15:00 UTC)과 같다.
 * - 날짜만("2026-10-13"): 한국 시간 그날 00:00
 * - 시간대 표시가 없는 일시: 한국 시간
 * - 오프셋/Z가 붙은 일시: 그 오프셋
 * - { dateTime, timeZone }: 그 시간대(timeZone이 없으면 한국 시간)
 */
export function toGraphUtc(input: DateTimeInput): GraphDateTime {
  const [text, zone] = typeof input === "string" ? [input, KST] : [input.dateTime, input.timeZone ?? KST];
  const ms = wallToUtcMs(parse(text), zone);
  return { dateTime: formatUtc(ms), timeZone: "UTC" };
}

/** Graph가 돌려준 일시(대개 UTC)를 한국 시간의 날짜와 시각으로 바꾼다. */
export function fromGraph(value: GraphDateTime): KstDateTime {
  const parts = parse(value.dateTime);
  const utcMs = wallToUtcMs(parts, value.timeZone);
  const kst = new Date(utcMs + KST_OFFSET_MIN * MS_PER_MIN);
  return {
    date: `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())}`,
    time: `${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}`,
  };
}

/** 응답에 보여 줄 모양: 한국 시간 기준의 일시로 바꾼 Graph 형식. */
export function toKstGraph(value: GraphDateTime): GraphDateTime {
  const { date, time } = fromGraph(value);
  return { dateTime: `${date}T${time}:00`, timeZone: KST };
}

export const isYmd = (text: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(text);
