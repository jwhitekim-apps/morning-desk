// my-task original code (not derived from upstream).
/**
 * 점검 결과의 네 가지 상태.
 * - ok: 정상
 * - degraded: 응답은 있지만 느리거나, 재시작이 잦거나, 건강 검사 실패, 기대 모델 일부 없음
 * - down: 응답 없음, 컨테이너 중지, 키 거부
 * - unknown: 이쪽 사정(도커 없음, 권한 없음, 설정 오류)으로 확인하지 못함 — 대상이 죽었다는 뜻이 아니다
 */
export type Status = "ok" | "degraded" | "down" | "unknown";

/** 여러 결과를 하나로 줄인다(가장 나쁜 것). unknown은 down보다 덜 나쁘고 degraded보다 나쁘게 본다. */
export function worst(statuses: Status[]): Status {
  const rank: Record<Status, number> = { ok: 0, degraded: 1, unknown: 2, down: 3 };
  return statuses.reduce<Status>((a, b) => (rank[b] > rank[a] ? b : a), "ok");
}

/** 동시 수를 제한해서 모두 실행한다. 하나가 실패해도 나머지는 계속한다(각 작업은 결과를 돌려주고 던지지 않아야 한다). */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
