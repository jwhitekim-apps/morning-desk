// my-task original code (not derived from upstream).
import { Socket } from "node:net";
import type { ServiceTarget } from "../config";
import { mapLimit, type Status } from "./status";

export type FetchFn = typeof fetch;

export interface ServiceResult {
  name: string;
  kind: "http" | "tcp";
  status: Status;
  /** 짧은 분류(예: timeout, refused, http_503, slow). 원문 오류 메시지는 넣지 않는다. */
  reason?: string;
  httpStatus?: number;
  durationMs: number;
  /** 평문(http) 주소로 점검했다. 운영에서는 https를 쓴다. */
  plaintext?: true;
}

const CONCURRENCY = 4;

export async function checkServices(targets: readonly ServiceTarget[], deps: { fetchFn?: FetchFn } = {}): Promise<ServiceResult[]> {
  const fetchFn = deps.fetchFn ?? fetch;
  return mapLimit(targets, CONCURRENCY, (t) => ("url" in t ? checkHttp(t, fetchFn) : checkTcpTarget(t)));
}

async function checkHttp(t: Extract<ServiceTarget, { url: string }>, fetchFn: FetchFn): Promise<ServiceResult> {
  const base = { name: t.name, kind: "http" as const, ...(t.plaintext ? { plaintext: true as const } : {}) };
  const startedAt = Date.now();
  try {
    // 리다이렉트는 따라가지 않는다(설정에 없는 주소로 요청이 나가지 않게). 3xx도 응답한 것으로 본다.
    const res = await fetchFn(t.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(t.timeoutMs) });
    await res.body?.cancel().catch(() => {});
    const durationMs = Date.now() - startedAt;
    if (res.status >= 500) return { ...base, status: "degraded", reason: `http_${res.status}`, httpStatus: res.status, durationMs };
    if (durationMs > t.slowMs) return { ...base, status: "degraded", reason: "slow", httpStatus: res.status, durationMs };
    return { ...base, status: "ok", httpStatus: res.status, durationMs };
  } catch (err) {
    return { ...base, status: "down", reason: networkReason(err), durationMs: Date.now() - startedAt };
  }
}

async function checkTcpTarget(t: Extract<ServiceTarget, { host: string }>): Promise<ServiceResult> {
  const r = await checkTcp(t.host, t.port, t.timeoutMs);
  const status: Status = !r.ok ? "down" : r.durationMs > t.slowMs ? "degraded" : "ok";
  return { name: t.name, kind: "tcp", status, ...(r.reason ? { reason: r.reason } : status === "degraded" ? { reason: "slow" } : {}), durationMs: r.durationMs };
}

/** TCP 연결만 해 보고 바로 닫는다. 데이터는 보내지 않는다. */
export function checkTcp(host: string, port: number, timeoutMs: number): Promise<{ ok: boolean; reason?: string; durationMs: number }> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const socket = new Socket();
    const done = (ok: boolean, reason?: string) => {
      socket.destroy();
      resolve({ ok, ...(reason ? { reason } : {}), durationMs: Date.now() - startedAt });
    };
    socket.setTimeout(timeoutMs, () => done(false, "timeout"));
    socket.once("connect", () => done(true));
    socket.once("error", (err) => done(false, errnoReason((err as NodeJS.ErrnoException).code)));
    socket.connect(port, host.replace(/^\[|\]$/g, ""));
  });
}

/** fetch 실패를 짧은 분류로 바꾼다. */
export function networkReason(err: unknown): string {
  const e = err as { name?: string; code?: string; cause?: { code?: string; name?: string } };
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  return errnoReason(e?.cause?.code ?? e?.code);
}

function errnoReason(code: string | undefined): string {
  switch (code) {
    case "ECONNREFUSED":
      return "refused";
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return "dns";
    case "ETIMEDOUT":
    case "UND_ERR_CONNECT_TIMEOUT":
      return "timeout";
    case "ECONNRESET":
    case "UND_ERR_SOCKET":
      return "reset";
    case "EHOSTUNREACH":
    case "ENETUNREACH":
      return "unreachable";
    default:
      return code && /CERT|SSL|TLS|SELF_SIGNED/i.test(code) ? "tls" : "network";
  }
}
