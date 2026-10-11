// my-task original code (not derived from upstream).
import type { LlmTarget } from "../config";
import { checkTcp, networkReason, type FetchFn } from "./services";
import type { Status } from "./status";

export type StepStatus = "ok" | "failed" | "skipped";

export interface LlmResult {
  name: string;
  status: Status;
  /** 처음 막힌 단계. 모두 정상이면 없다. */
  failedAt?: "port" | "api" | "auth" | "models";
  reason?: string;
  steps: { port: StepStatus; api: StepStatus; auth: StepStatus; models: StepStatus };
  /** 설정에 적은 기대 모델 중 목록에 없는 것. */
  missingModels?: string[];
  durationMs: number;
  plaintext?: true;
}

/**
 * 모델 서버를 단계별로 점검한다: 포트 연결 → `GET /v1/models`(API 응답과 키) → 기대 모델이 목록에 있는지.
 * 모델에게 글을 생성하게 하는 요청은 하지 않는다(모델 목록 조회는 모델을 메모리에 올리지 않는다).
 */
export async function checkLlm(t: LlmTarget, apiKey: string | undefined, deps: { fetchFn?: FetchFn } = {}): Promise<LlmResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const startedAt = Date.now();
  const steps: LlmResult["steps"] = { port: "skipped", api: "skipped", auth: "skipped", models: "skipped" };
  const out = (status: Status, extra: Partial<LlmResult> = {}): LlmResult => ({
    name: t.name,
    status,
    ...extra,
    steps,
    durationMs: Date.now() - startedAt,
    ...(t.plaintext ? { plaintext: true as const } : {}),
  });

  const port = await checkTcp(t.host, t.port, t.timeoutMs);
  if (!port.ok) {
    steps.port = "failed";
    return out("down", { failedAt: "port", reason: port.reason });
  }
  steps.port = "ok";

  let res: Response;
  try {
    res = await fetchFn(`${t.baseUrl}/models`, {
      method: "GET",
      headers: { accept: "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      // 다른 주소로 보내지면 따라가지 않는다(키가 다른 곳으로 가지 않게).
      redirect: "manual",
      signal: AbortSignal.timeout(t.timeoutMs),
    });
  } catch (err) {
    steps.api = "failed";
    return out("down", { failedAt: "api", reason: networkReason(err) });
  }

  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel().catch(() => {});
    steps.api = "ok";
    steps.auth = "failed";
    // 키를 설정하지 않아서 거부된 것은 이쪽 설정 문제다(서버가 죽은 것이 아니다).
    return apiKey ? out("down", { failedAt: "auth", reason: `http_${res.status}` }) : out("unknown", { failedAt: "auth", reason: "no_api_key" });
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    steps.api = "failed";
    return out("down", { failedAt: "api", reason: `http_${res.status}` });
  }
  let ids: string[];
  try {
    const body = (await res.json()) as { data?: { id?: unknown }[] };
    if (!Array.isArray(body.data)) throw new Error("no data");
    ids = body.data.map((m) => m.id).filter((x): x is string => typeof x === "string");
  } catch {
    steps.api = "failed";
    return out("down", { failedAt: "api", reason: "unexpected_response" });
  }
  steps.api = "ok";
  steps.auth = "ok";

  const missing = t.models.filter((m) => !ids.includes(m));
  if (missing.length > 0) {
    steps.models = "failed";
    return out("degraded", { failedAt: "models", reason: "model_missing", missingModels: missing });
  }
  steps.models = "ok";
  return out("ok");
}
