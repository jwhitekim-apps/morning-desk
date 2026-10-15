// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import type { DockerRunner, RunResult } from "../src/checks/docker";
import { DATA_NOTICE, normalize, summarize, summarizeDockerLogs } from "../src/checks/logs";
import { parseTargets } from "../src/config";

const containers = parseTargets({ containers: [{ name: "veloo-app" }] }).containers;

function fake(answer: RunResult) {
  const calls: string[][] = [];
  const run: DockerRunner = async (args) => {
    calls.push([...args]);
    return answer;
  };
  return { run, calls };
}
const out = (lines: string[], stderr: string[] = []): RunResult => ({ code: 0, stdout: lines.join("\n") + "\n", stderr: stderr.join("\n") });

describe("docker logs: fixed arguments and limits", () => {
  it("runs exactly `docker logs --since <h>h --tail <n> -- <name>`", async () => {
    const { run, calls } = fake(out(["hello"]));
    await summarizeDockerLogs(containers, run, { container: "veloo-app" });
    await summarizeDockerLogs(containers, run, { container: "veloo-app", hours: 72, lines: 5000 });
    expect(calls).toEqual([
      ["logs", "--since", "24h", "--tail", "2000", "--", "veloo-app"],
      ["logs", "--since", "72h", "--tail", "5000", "--", "veloo-app"],
    ]);
  });

  it("a name not in the config, or values over the limits, are input errors and docker is never called", async () => {
    const { run, calls } = fake(out([]));
    const bad = [
      { container: "other" },
      { container: "veloo-app; rm -rf /" },
      { container: "veloo-app", hours: 73 },
      { container: "veloo-app", hours: 0 },
      { container: "veloo-app", hours: 1.5 },
      { container: "veloo-app", lines: 5001 },
      { container: "veloo-app", lines: -1 },
    ];
    for (const input of bad) {
      await expect(summarizeDockerLogs(containers, run, input), JSON.stringify(input)).rejects.toMatchObject({ code: "validation_error" });
    }
    expect(calls).toHaveLength(0);
  });

  it("hitting the line limit is marked as truncated", async () => {
    const { run } = fake(out(Array.from({ length: 10 }, (_, i) => `line ${i}`)));
    expect(await summarizeDockerLogs(containers, run, { container: "veloo-app", lines: 10 })).toMatchObject({ linesRead: 10, truncated: true });
    expect(await summarizeDockerLogs(containers, run, { container: "veloo-app", lines: 11 })).toMatchObject({ truncated: false });
    const big = fake({ code: null, stdout: "x\n", stderr: "", overflow: true });
    expect(await summarizeDockerLogs(containers, big.run, { container: "veloo-app" })).toMatchObject({ truncated: true });
  });

  it("docker problems are check_unavailable, not 'no errors'", async () => {
    for (const answer of [
      { code: null, stdout: "", stderr: "", spawnError: "ENOENT" },
      { code: 1, stdout: "", stderr: "permission denied while trying to connect to the Docker daemon socket" },
      { code: 1, stdout: "", stderr: "Error response from daemon: No such container: veloo-app" },
    ] as RunResult[]) {
      await expect(summarizeDockerLogs(containers, fake(answer).run, { container: "veloo-app" })).rejects.toMatchObject({ code: "check_unavailable" });
    }
  });
});

describe("log summary", () => {
  it("the same error 100 times is one group with count 100; stderr lines are counted too", async () => {
    const same = Array.from({ length: 100 }, (_, i) => `2026-10-11T07:00:${String(i % 60).padStart(2, "0")}Z ERROR db timeout after ${1000 + i}ms (request ${i})`);
    const { run } = fake(out([...same, "INFO started", "GET /health 200"], ["Traceback (most recent call last):"]));
    const r = await summarizeDockerLogs(containers, run, { container: "veloo-app" });
    expect(r.errorLines).toBe(101);
    expect(r.distinctErrors).toBe(2);
    expect(r.top[0]).toEqual({ count: 100, sample: "ERROR db timeout after Nms (request N)" });
    expect(r.notice).toBe(DATA_NOTICE);
  });

  it("no error lines: 0, with the range and line count", async () => {
    const { run } = fake(out(["INFO started", "GET / 200"]));
    expect(await summarizeDockerLogs(containers, run, { container: "veloo-app", hours: 6 })).toMatchObject({
      container: "veloo-app",
      sinceHours: 6,
      linesRead: 2,
      errorLines: 0,
      distinctErrors: 0,
      top: [],
    });
  });

  it("at most 5 groups, each sample at most 200 characters", () => {
    const lines = Array.from({ length: 8 }, (_, i) => `error kind-${"abcdefgh"[i]} ${"x ".repeat(300)}`);
    const r = summarize(lines);
    expect(r.distinctErrors).toBe(8);
    expect(r.top).toHaveLength(5);
    for (const g of r.top) expect(Array.from(g.sample).length).toBeLessThanOrEqual(200);
  });

  it("tokens, passwords, keys, long hex and personal details are masked, and raw lines never appear", async () => {
    const raw = [
      "ERROR auth failed: Authorization: Bearer abc.DEF-ghi_SECRET1 from 10.0.0.12:5432",
      "ERROR login failed password=hunter2SECRET2 user=kim",
      'ERROR upstream {"api_key":"sk-SECRET3-xyz","status":500}',
      "ERROR bad session 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "ERROR mail to someone.SECRET4@example.com failed token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SECRET5sig",
      "ERROR request id 123e4567-e89b-12d3-a456-426614174000 cookie: sid=SECRET6",
    ];
    const { run } = fake(out(raw));
    // 상위 5개만 응답에 나오므로, 여섯 줄 모두의 정규화 결과도 함께 확인한다.
    const text = JSON.stringify(await summarizeDockerLogs(containers, run, { container: "veloo-app" })) + raw.map(normalize).join("\n");
    for (const s of ["SECRET1", "hunter2", "SECRET3", "9f86d081884c7d659a2f", "someone.SECRET4", "SECRET5", "123e4567", "SECRET6", "10.0.0.12"]) {
      expect(text, s).not.toContain(s);
    }
    for (const line of raw) expect(text).not.toContain(line);
    expect(normalize("ERROR call failed: Bearer abc123SECRET")).toBe("ERROR call failed: Bearer [secret]");
    expect(text).toContain("password=[secret]");
  });

  it("normalize keeps the shape of the message", () => {
    expect(normalize("2026-10-11 07:00:01,123 ERROR worker 12 crashed: exit 137")).toBe("ERROR worker N crashed: exit N");
  });
});
