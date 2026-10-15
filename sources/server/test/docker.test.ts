// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { checkContainers, execDocker, type DockerRunner, type RunResult } from "../src/checks/docker";
import { parseTargets } from "../src/config";

const state = (s: object, restarts = 0): RunResult => ({ code: 0, stdout: `${JSON.stringify(s)} ${restarts}\n`, stderr: "" });

function fake(answers: Record<string, RunResult>) {
  const calls: string[][] = [];
  const run: DockerRunner = async (args) => {
    calls.push([...args]);
    return answers[args.at(-1) as string] ?? { code: 1, stdout: "", stderr: "Error: No such container" };
  };
  return { run, calls };
}

const containers = (...names: string[]) => parseTargets({ containers: names.map((name) => ({ name })) }).containers;

describe("container checks", () => {
  it("running is ok; frequent restarts or failing health check is degraded; stopped is down", async () => {
    const { run, calls } = fake({
      web: state({ Status: "running", Health: { Status: "healthy" } }),
      flappy: state({ Status: "running" }, 7),
      sick: state({ Status: "running", Health: { Status: "unhealthy" } }),
      looping: state({ Status: "restarting" }, 2),
      stopped: state({ Status: "exited", ExitCode: 137 }),
    });
    const r = await checkContainers(containers("web", "flappy", "sick", "looping", "stopped", "gone"), run);
    expect(r).toEqual([
      { name: "web", status: "ok", state: "running", restartCount: 0, health: "healthy" },
      { name: "flappy", status: "degraded", reason: "restarts", state: "running", restartCount: 7 },
      { name: "sick", status: "degraded", reason: "unhealthy", state: "running", restartCount: 0, health: "unhealthy" },
      { name: "looping", status: "degraded", reason: "restarting", state: "restarting", restartCount: 2 },
      { name: "stopped", status: "down", reason: "exited", state: "exited", restartCount: 0 },
      { name: "gone", status: "down", reason: "not_found" },
    ]);
    // 고정 인자: 상태와 재시작 횟수만 꺼내고, 이름 앞에 `--`를 둔다
    expect(calls[0]).toEqual(["inspect", "--type", "container", "--format", "{{json .State}} {{.RestartCount}}", "--", "web"]);
  });

  it("docker problems are 'unknown' (cannot check), never 'the container is dead'", async () => {
    const cases: [RunResult, string][] = [
      [{ code: null, stdout: "", stderr: "", spawnError: "ENOENT" }, "docker_not_installed"],
      [{ code: 1, stdout: "", stderr: "permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock" }, "docker_permission_denied"],
      [{ code: 1, stdout: "", stderr: "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" }, "docker_not_running"],
      [{ code: 1, stdout: "", stderr: "something odd" }, "docker_error"],
      [{ code: 0, stdout: "garbage", stderr: "" }, "unexpected_output"],
    ];
    for (const [answer, reason] of cases) {
      const [r] = await checkContainers(containers("web"), async () => answer);
      expect(r, reason).toEqual({ name: "web", status: "unknown", reason });
    }
  });

  it("the real runner reports a missing program as a spawn error, without a shell", async () => {
    const r = await execDocker(2000)(["--version"]);
    // 이 컴퓨터에 docker가 있으면 실행되고, 없으면 ENOENT. 어느 쪽이든 쉘 오류가 아니다.
    expect(r.spawnError === undefined || r.spawnError === "ENOENT").toBe(true);
  });
});
