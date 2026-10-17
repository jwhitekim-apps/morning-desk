import { ServerChecksError, type ServerChecks } from "@morning-desk/server";
import { describe, expect, it, vi } from "vitest";
import { readServerStatus } from "../src/briefing/server";

const LLM_OK = { name: "school-llm", status: "ok", steps: { port: "ok", api: "ok", auth: "ok", models: "ok" }, durationMs: 5 };

function fake(over: Partial<Record<keyof ServerChecks, unknown>> = {}): ServerChecks {
  return {
    listTargets: vi.fn(async () => { throw new Error("listTargets must not be needed"); }),
    checkServices: vi.fn(async () => ({
      overall: "ok",
      services: [{ name: "veloo", kind: "http", status: "ok", durationMs: 3 }, { name: "folio", kind: "http", status: "ok", durationMs: 4 }],
      containers: [{ name: "db", status: "ok" }],
    })),
    checkLlm: vi.fn(async () => LLM_OK),
    summarizeDockerLogs: vi.fn(async () => { throw new Error("summarizeDockerLogs must never be called"); }),
    ...over,
  } as unknown as ServerChecks;
}

describe("readServerStatus", () => {
  it("all ok", async () => {
    expect(await readServerStatus(fake())).toEqual({ state: "ok", problems: [] });
  });

  it("one service down: its name appears, the others are untouched", async () => {
    const s = fake({
      checkServices: async () => ({
        overall: "down",
        services: [{ name: "veloo", kind: "http", status: "down", reason: "refused", durationMs: 1 }, { name: "folio", kind: "http", status: "ok", durationMs: 4 }],
        containers: [],
      }),
    });
    expect(await readServerStatus(s)).toEqual({ state: "issues", problems: ["veloo 중단"] });
  });

  it("degraded llm is reported by name", async () => {
    const s = fake({ checkLlm: async () => ({ ...LLM_OK, status: "degraded", failedAt: "models", missingModels: ["x"] }) });
    expect(await readServerStatus(s)).toEqual({ state: "issues", problems: ["school-llm 저하"] });
  });

  it("docker unavailable is 점검 불가, not 중단", async () => {
    const s = fake({
      checkServices: async () => ({ overall: "unknown", services: [], containers: [{ name: "docker", status: "unknown", reason: "docker_missing" }] }),
    });
    const r = await readServerStatus(s);
    expect(r.problems).toEqual(["docker 점검 불가"]);
    expect(r.problems.join()).not.toContain("중단");
  });

  it("missing targets config is skipped", async () => {
    const err = new ServerChecksError("config_missing", "No targets at /secret/path");
    const r = await readServerStatus(fake({ checkServices: async () => { throw err; }, checkLlm: async () => { throw err; } }));
    expect(r).toEqual({ state: "skipped", problems: [] });
  });

  it("no llm target only skips the llm check", async () => {
    const r = await readServerStatus(fake({ checkLlm: async () => { throw new ServerChecksError("config_missing", "x"); } }));
    expect(r).toEqual({ state: "ok", problems: [] });
  });

  it("an unexpected error is failed with the code only, no raw message", async () => {
    const r = await readServerStatus(fake({ checkServices: async () => { throw new Error("boom http://10.0.0.1 key=abc"); } }));
    expect(r.state).toBe("failed");
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0]).not.toMatch(/10\.0|key|abc|boom/);
  });

  it("calls only checkServices and checkLlm, never summarizeDockerLogs or listTargets", async () => {
    const s = fake();
    await readServerStatus(s);
    expect(s.checkServices).toHaveBeenCalledTimes(1);
    expect(s.checkLlm).toHaveBeenCalledTimes(1);
    expect(s.summarizeDockerLogs).not.toHaveBeenCalled();
    expect(s.listTargets).not.toHaveBeenCalled();
    // 가짜는 허용된 함수만 드러낸다: 모델 생성 같은 다른 호출 수단이 없다.
    expect(Object.keys(s).sort()).toEqual(["checkLlm", "checkServices", "listTargets", "summarizeDockerLogs"]);
  });
});
