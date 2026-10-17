// my-task original code (not derived from upstream).
import { compose, readTodo } from "./briefing/deterministic";
import { deliver, type Delivery } from "./briefing/deliver";
import { describeFailure } from "./briefing/failures";
import { readServerStatus } from "./briefing/server";
import { buildSourceSections, collectSources, type CollectOptions, type Sources } from "./briefing/sources";
import { kstToday } from "./briefing/todo";
import { pickTop } from "./briefing/top";
import { applyWrites, DEFAULT_MAX_CREATES, findListId, planWrites, type WritePlan, type WriteResult } from "./briefing/writes";
import type { Logger } from "@morning-desk/shared";
import type { SourceModules } from "./modules";
import { emptyMemory, prune, type MemoryStore } from "./memory";
import type { Model } from "./model/client";
import { interpret, type Interpretation } from "./model/interpret";

export interface RunDeps {
  /** 하루 실행이 부를 수 있는 것은 이 모듈들의 함수뿐이다(로그인 함수는 받지 않는다). */
  sources: SourceModules;
  /** 모델이 설정되지 않았으면 null(모델 없는 기본 브리핑이 나간다). */
  model: Model | null;
  /** 기록 저장소. null이면 기억 없이 돈다. */
  memory: MemoryStore | null;
  logger: Logger;
}

export interface RunOptions {
  /** 켜져 있으면 카톡 전송, 태스크 추가, 기록 갱신을 하지 않는다. 읽기와 모델 호출은 그대로 한다. */
  dryRun: boolean;
  /** To Do에 태스크를 실제로 추가한다. 기본은 꺼짐(비교 전용 병행 운영 단계). */
  createTasks?: boolean;
  maxCreates?: number;
  /** 태스크를 넣을 To Do 목록 이름(없으면 기본 목록). */
  listName?: string;
  /** 같은 날 이미 보냈어도 다시 보낸다. */
  force?: boolean;
  now?: Date;
  collect?: CollectOptions;
}

export interface RunResult {
  status: "sent" | "dry-run" | "already-sent";
  messages: string[];
  delivery?: Delivery;
  sources?: Sources;
  failures: string[];
  interpretation?: Interpretation;
  plan?: WritePlan;
  writes?: WriteResult;
}

const KOREAN_WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 하루 한 번의 브리핑.
 * 소스 읽기(한 소스의 실패는 실패 구역으로) → To Do 읽기 → 모델 해석(실패하면 모델 없는 기본 브리핑) →
 * 코드가 쓰기 결정(설정이 켜졌을 때만 추가) → 카톡 전송 → 기록 저장(드라이런은 저장하지 않음).
 */
export async function run(deps: RunDeps, opts: RunOptions): Promise<RunResult> {
  const { todo: todoSource, kakao } = deps.sources;
  const now = opts.now ?? new Date();
  const today = kstToday(now);
  const memory = prune(deps.memory?.load() ?? emptyMemory(), today);

  if (!opts.dryRun && !opts.force && memory.lastSentDate === today) {
    // 같은 날 두 번 보내지 않는다. 다시 보내려면 force(확인 옵션)가 필요하다.
    return { status: "already-sent", messages: [], failures: [] };
  }

  const processed = { mail: new Set(Object.keys(memory.processed.mail)), github: new Set(Object.keys(memory.processed.github)) };
  // 서버 점검은 소스 읽기와 함께 돈다(읽기 전용, 던지지 않는다; 드라이런에서도 한다).
  const readStart = Date.now();
  const [collected, server] = await Promise.all([
    collectSources(deps.sources, now, { ...opts.collect, processed }),
    readServerStatus(deps.sources.server),
  ]);
  const { sources, failures: sourceFailures, disabled: disabledSources } = collected;
  const sourceSections = buildSourceSections(collected);
  deps.logger.info("sources read", { mails: sources.mails.length, github: sources.github.length, papers: sources.papers.length, durationMs: Date.now() - readStart });
  const extra = { sourceSections, disabledSources, server };
  const { todo, failure: todoFailure } = await readTodo(todoSource, now);
  if (!todo) {
    // To Do를 못 읽으면 일을 판단할 기준이 없다: 실패 알림만 보낸다.
    const { messages } = compose({ now, todo: null, failures: [...sourceFailures, todoFailure ?? "To Do 오류"], ...extra });
    const delivery = await deliver(kakao, messages, { dryRun: opts.dryRun });
    return { status: opts.dryRun ? "dry-run" : "sent", messages, delivery, sources, failures: [...sourceFailures, todoFailure ?? "To Do 오류"] };
  }

  const yesterdayKey = Object.keys(memory.days).filter((d) => d < today).sort().at(-1);
  let interpretation: Interpretation | undefined;
  let modelFailure: string | null = null;
  if (!deps.model) {
    modelFailure = "모델 설정 누락";
  } else {
    try {
      interpretation = await interpret(deps.model, {
        today,
        weekday: KOREAN_WEEKDAY[new Date(`${today}T00:00:00Z`).getUTCDay()] ?? "",
        todo: todo.existing,
        sources,
        yesterday: yesterdayKey ? memory.days[yesterdayKey] ?? null : null,
      }, deps.logger);
    } catch (err) {
      modelFailure = describeFailure("모델", err);
    }
  }

  const failures = [...(modelFailure ? [modelFailure] : []), ...sourceFailures];
  const notes: string[] = [];
  let plan: WritePlan | undefined;
  let writes: WriteResult | undefined;
  const created: { name: string; deadline: string }[] = [];
  const uncertain: string[] = [];

  if (interpretation) {
    plan = planWrites(interpretation.candidates, sources, todo.existing, opts.maxCreates ?? DEFAULT_MAX_CREATES);
    const willCreate = Boolean(opts.createTasks) && !opts.dryRun;
    if (willCreate && plan.toCreate.length > 0) {
      try {
        writes = await applyWrites(todoSource, plan, await findListId(todoSource, opts.listName));
      } catch (err) {
        failures.push(describeFailure("To Do", err));
      }
      for (const c of writes?.created ?? []) created.push({ name: c.title, deadline: c.due ?? "" });
      if (writes && writes.failed.length > 0) failures.push(`To Do 추가 실패 ${writes.failed.length}건`);
    } else {
      // 비교 전용(또는 드라이런)이면 만들 예정인 일을 보여 주기만 한다.
      for (const t of plan.toCreate) created.push({ name: t.title, deadline: t.due ?? "" });
      if (plan.toCreate.length > 0) notes.push(opts.dryRun ? "드라이런이라 To Do에 추가하지 않았어요." : `태스크 추가가 꺼져 있어요(찾은 일 ${plan.toCreate.length}건은 To Do에 없어요).`);
    }
    for (const t of plan.toCreate) if (t.needsDateCheck) uncertain.push(`마감 확인 필요: ${t.title}`);
    if (plan.overLimit.length > 0) notes.push(`한 번에 ${opts.maxCreates ?? DEFAULT_MAX_CREATES}건까지만 추가해요. ${plan.overLimit.length}건은 추가하지 않았어요.`);
  } else {
    notes.push("모델 없이 만든 기본 브리핑이에요.");
  }

  // 최근 며칠 동안 던진 질문은 모델이 다시 써도 빼서, 같은 질문을 되풀이하지 않는다.
  const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
  const asked = new Set(Object.entries(memory.days).filter(([d]) => d < today).flatMap(([, r]) => r.questions.map(norm)));
  const remark = (interpretation?.remark ?? []).map((s) => s.text).filter((t) => !asked.has(norm(t)));
  const { messages } = compose({ now, todo, failures, created, uncertain, notes, remark, ...extra });
  const delivery = await deliver(kakao, messages, { dryRun: opts.dryRun });

  if (!opts.dryRun && deps.memory) {
    const next = { ...memory, processed: { mail: { ...memory.processed.mail }, github: { ...memory.processed.github } }, days: { ...memory.days } };
    if (interpretation) {
      // 모델이 실제로 읽은 소스만 처리한 것으로 기록한다(모델이 실패했으면 다음 실행에서 다시 본다).
      for (const m of sources.mails) next.processed.mail[m.id] = today;
      for (const g of sources.github) next.processed.github[g.id] = today;
    }
    next.lastSentDate = today;
    next.days[today] = { top: pickTop(todo).map((t) => t.name), created: created.map((c) => c.name), questions: remark.filter((t) => /[?？]\s*$/.test(t)) };
    deps.memory.save(next);
  }

  return { status: opts.dryRun ? "dry-run" : "sent", messages, delivery, sources, failures, interpretation, plan, writes };
}
