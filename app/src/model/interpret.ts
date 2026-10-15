// my-task original code (not derived from upstream).
import { AppError } from "../errors";
import type { Logger } from "../logger";
import type { Model } from "./client";
import { buildMessages, dataItems, type DataItem, type PromptInput } from "./prompt";
import { MAX_CANDIDATES, MAX_REMARK, ModelOutputSchema, type Candidate, type Sentence } from "./schema";

export const TITLE_LIMIT = 80;
/** 소스 하나(메일 한 통, 이슈 하나)에서 받아들이는 후보의 최대 개수. 한 소스의 지시문이 태스크를 대량으로 만들게 할 수 없다. */
export const MAX_PER_SOURCE = 3;

/**
 * 비서에게 내리는 지시처럼 보이는 제목(프롬프트 주입이 통했을 때 나오는 모양). 이런 제목의 후보는 버린다.
 * 정상적인 할 일 제목과 겹치지 않도록 좁게 잡는다.
 */
const INSTRUCTION_LIKE = /(이전|위의?|앞의?|모든)\s*(지시|명령|규칙|지침).*(무시|따르|잊)|ignore\s+(all|any|the|previous|prior)|disregard\s+(all|previous|the)|system\s*prompt|시스템\s*프롬프트|태스크를?\s*\d+\s*개|\d+\s*개의?\s*태스크/i;

export interface AcceptedCandidate {
  title: string;
  due: string | null;
  source: "mail" | "github";
  sourceId: string;
  evidence: string;
  /** 모델이 낸 날짜를 근거가 없어서 버렸다(마감 없는 후보로 남긴다). */
  dueDropped?: true;
}

export interface Interpretation {
  candidates: AcceptedCandidate[];
  remark: Sentence[];
  /** 코드가 버린 것의 개수(사유별). 브리핑과 로그에 건수만 쓴다. */
  dropped: { candidates: number; dates: number; sentences: number };
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
const isRealDate = (text: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
};

/** 제목: 줄바꿈과 제어문자를 없애고 길이를 제한한다(소스의 긴 글이나 지시문이 제목으로 흘러들지 않게). */
export function cleanTitle(raw: string): string {
  const flat = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const points = Array.from(flat);
  return points.length <= TITLE_LIMIT ? flat : `${points.slice(0, TITLE_LIMIT - 1).join("")}…`;
}

/** 모델의 글에서 JSON 객체를 꺼낸다(앞뒤에 설명이 붙어도 첫 번째 `{`부터 짝이 맞는 `}`까지). */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no json");
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unbalanced json");
}

function parseOutput(text: string) {
  const r = ModelOutputSchema.safeParse(extractJson(text));
  if (!r.success) throw new Error(r.error.issues.map((i) => i.path.join(".")).join(", ") || "shape");
  return r.data;
}

/**
 * 모델에게 자료를 보내 후보와 한마디를 받고, 코드가 검증한다.
 * - 응답이 구조에 맞지 않으면 한 번만 다시 요청하고, 그래도 안 되면 `model_error`.
 * - 근거 인용이 자료에 없는 문장은 버리고, 근거 없는 날짜는 비운다(날짜를 지어내지 않는다).
 */
export async function interpret(model: Model, input: PromptInput, logger: Logger): Promise<Interpretation> {
  const messages = buildMessages(input);
  let output;
  try {
    output = parseOutput(await model.complete(messages));
  } catch (err) {
    if (err instanceof AppError) throw err; // 연결·시간 초과는 다시 요청해도 소용없다(폴백으로 간다)
    logger.warn("model answer rejected", { op: "interpret", attempt: 0, errorCode: "validation_error" });
    const retryNote = { role: "user" as const, content: "이전 응답이 요구한 JSON 모양에 맞지 않았다. 같은 자료로, 설명 없이 JSON 하나만 다시 내라." };
    try {
      output = parseOutput(await model.complete([...messages, retryNote]));
    } catch (err2) {
      if (err2 instanceof AppError) throw err2;
      throw new AppError("model_error", "The model's answer did not match the required format, even after one retry.");
    }
  }

  const items = dataItems(input);
  const byKey = new Map<string, DataItem>(items.map((d) => [`${d.source}:${d.id}`, d]));
  const everything = norm(items.map((d) => d.text).join("\n"));
  const dropped = { candidates: 0, dates: 0, sentences: 0 };

  const candidates: AcceptedCandidate[] = [];
  const seen = new Set<string>();
  const perSource = new Map<string, number>();
  // 소스당 상한을 먼저 적용하고 전체 상한은 나중에 적용한다. 한 소스(지시문이 든 메일)가 후보를 쏟아내도
  // 다른 소스의 정상 후보가 밀려나지 않게 하기 위해서다. 처리량은 RAW_LIMIT으로 묶는다.
  const RAW_LIMIT = 1000;
  dropped.candidates += Math.max(0, output.candidates.length - RAW_LIMIT);
  for (const c of output.candidates.slice(0, RAW_LIMIT) as Candidate[]) {
    const item = byKey.get(`${c.source}:${c.sourceId}`);
    const title = cleanTitle(c.title);
    // 입력에 없던 소스를 가리키거나, 근거 인용이 그 소스에 없으면 버린다.
    if (!item || !title || norm(c.evidence).length === 0 || !norm(item.text).includes(norm(c.evidence))) { dropped.candidates++; continue; }
    // 지시문처럼 보이는 제목, 그리고 한 소스에서 너무 많이 나온 후보는 받아들이지 않는다(프롬프트 주입 방어).
    if (INSTRUCTION_LIKE.test(title)) { dropped.candidates++; continue; }
    const count = perSource.get(`${c.source}:${c.sourceId}`) ?? 0;
    if (count >= MAX_PER_SOURCE) { dropped.candidates++; continue; }
    const key = `${c.sourceId}\u0000${norm(title)}`;
    if (seen.has(key)) { dropped.candidates++; continue; }
    seen.add(key);
    perSource.set(`${c.source}:${c.sourceId}`, count + 1);
    let due = c.due;
    let dueDropped = false;
    if (due !== null && (!isRealDate(due) || !c.dueEvidence || norm(c.dueEvidence).length === 0 || !norm(item.text).includes(norm(c.dueEvidence)))) {
      due = null;
      dueDropped = true;
      dropped.dates++;
    }
    candidates.push({ title, due, source: c.source, sourceId: c.sourceId, evidence: c.evidence, ...(dueDropped ? { dueDropped: true as const } : {}) });
  }

  if (candidates.length > MAX_CANDIDATES) {
    dropped.candidates += candidates.length - MAX_CANDIDATES;
    candidates.length = MAX_CANDIDATES;
  }

  dropped.sentences += Math.max(0, output.remark.length - MAX_REMARK);
  const remark = output.remark.slice(0, MAX_REMARK).filter((s) => {
    const ok = norm(s.evidence).length > 0 && everything.includes(norm(s.evidence));
    if (!ok) dropped.sentences++;
    return ok;
  });

  logger.info("model answer checked", { op: "interpret", count: candidates.length });
  return { candidates, remark, dropped };
}
