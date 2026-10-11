// my-task original code (not derived from upstream).
import { execFile } from "node:child_process";
import type { ContainerTarget } from "../config";
import { mapLimit, type Status } from "./status";

export interface RunResult {
  /** 프로세스 종료 코드. 실행 자체를 못 했으면 null. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** 실행 자체가 실패한 이유(ENOENT 등). */
  spawnError?: string;
  /** 출력이 상한을 넘어 잘렸다. */
  overflow?: boolean;
}

/** `docker`에 인자 배열을 넘겨 실행한다. 쉘을 거치지 않는다. 다른 프로그램은 실행할 수 없다. */
export type DockerRunner = (args: readonly string[]) => Promise<RunResult>;

const MAX_BUFFER = 8 * 1024 * 1024;

export function execDocker(timeoutMs = 15_000): DockerRunner {
  return (args) =>
    new Promise((resolve) => {
      execFile("docker", [...args], { shell: false, timeout: timeoutMs, maxBuffer: MAX_BUFFER, windowsHide: true }, (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
        if (e && typeof e.code === "string") {
          // ENOENT(도커 없음), ERR_CHILD_PROCESS_STDIO_MAXBUFFER(출력 과다) 등
          if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return resolve({ code: null, stdout: String(stdout), stderr: String(stderr), overflow: true });
          return resolve({ code: null, stdout: "", stderr: "", spawnError: e.code });
        }
        if (e?.killed) return resolve({ code: null, stdout: String(stdout), stderr: String(stderr), spawnError: "timeout" });
        resolve({ code: e ? Number(e.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) });
      });
    });
}

/** 도커 자체를 쓸 수 없는 경우를 짧은 이유로 분류한다. 해당하지 않으면 undefined. */
export function dockerUnavailable(r: RunResult): string | undefined {
  if (r.spawnError === "ENOENT") return "docker_not_installed";
  if (r.spawnError === "timeout") return "docker_timeout";
  if (r.spawnError) return "docker_error";
  if (/permission denied/i.test(r.stderr)) return "docker_permission_denied";
  if (/cannot connect to the docker daemon|is the docker daemon running/i.test(r.stderr)) return "docker_not_running";
  return undefined;
}

export interface ContainerResult {
  name: string;
  status: Status;
  reason?: string;
  state?: string;
  health?: string;
  restartCount?: number;
}

const CONCURRENCY = 4;
// 상태와 재시작 횟수만 꺼낸다(환경 변수 같은 설정은 읽지 않는다).
const INSPECT_FORMAT = "{{json .State}} {{.RestartCount}}";

export function inspectArgs(name: string): string[] {
  return ["inspect", "--type", "container", "--format", INSPECT_FORMAT, "--", name];
}

export async function checkContainers(targets: readonly ContainerTarget[], run: DockerRunner): Promise<ContainerResult[]> {
  return mapLimit(targets, CONCURRENCY, async (t) => {
    const r = await run(inspectArgs(t.name));
    const unavailable = dockerUnavailable(r);
    if (unavailable) return { name: t.name, status: "unknown", reason: unavailable };
    if (r.code !== 0) {
      if (/no such (container|object)/i.test(r.stderr)) return { name: t.name, status: "down", reason: "not_found" };
      return { name: t.name, status: "unknown", reason: "docker_error" };
    }
    return judge(t, r.stdout);
  });
}

function judge(t: ContainerTarget, out: string): ContainerResult {
  const m = /^(\{.*\})\s+(\d+)\s*$/s.exec(out.trim());
  let state: { Status?: string; Health?: { Status?: string } } | undefined;
  try {
    state = m ? JSON.parse(m[1] as string) : undefined;
  } catch {
    state = undefined;
  }
  if (!m || !state || typeof state.Status !== "string") return { name: t.name, status: "unknown", reason: "unexpected_output" };
  const restartCount = Number(m[2]);
  const health = state.Health?.Status;
  const base = { name: t.name, state: state.Status, restartCount, ...(health ? { health } : {}) };
  switch (state.Status) {
    case "running":
      if (health === "unhealthy") return { ...base, status: "degraded", reason: "unhealthy" };
      if (restartCount >= t.restartWarn) return { ...base, status: "degraded", reason: "restarts" };
      return { ...base, status: "ok" };
    case "restarting":
      return { ...base, status: "degraded", reason: "restarting" };
    case "paused":
      return { ...base, status: "degraded", reason: "paused" };
    default:
      // exited, dead, created, removing
      return { ...base, status: "down", reason: state.Status };
  }
}
