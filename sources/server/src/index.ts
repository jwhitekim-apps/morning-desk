// my-task original code (not derived from upstream).
import type { Logger } from "@morning-desk/shared";
import { checkContainers, execDocker, type ContainerResult, type DockerRunner } from "./checks/docker";
import type { Checks } from "./checks/index";
import { checkLlm, type LlmResult } from "./checks/llm";
import { summarizeDockerLogs, type LogSummary } from "./checks/logs";
import { checkServices, type FetchFn, type ServiceResult } from "./checks/services";
import { worst, type Status } from "./checks/status";
import { loadTargets, NAME_PATTERN, type ServerChecksConfig } from "./config";
import { AppError } from "./errors";

export { loadConfig, targetsPath, type ServerChecksConfig } from "./config";
export { AppError as ServerChecksError, type ErrorCode as ServerChecksErrorCode } from "./errors";
export { DATA_NOTICE, DEFAULT_HOURS, DEFAULT_LINES, MAX_HOURS, MAX_LINES, type LogSummary } from "./checks/logs";
export type { ContainerResult } from "./checks/docker";
export type { LlmResult } from "./checks/llm";
export type { ServiceResult } from "./checks/services";
export type { Status } from "./checks/status";

export interface TargetList {
  services: { name: string; kind: "http" | "tcp"; plaintext?: true }[];
  containers: string[];
  llm: { name: string; expectedModels: string[]; plaintext?: true } | null;
}

/**
 * 집 서버의 서비스와 컨테이너, 학교 LLM 서버를 **점검만** 하는 함수들. 재시작, 명령 실행, 로그 삭제는 없다.
 * 점검 대상은 설정 파일(`targets.json`)에 적은 것뿐이고, 입력으로 주소·포트·명령·파일 경로를 받지 않는다.
 * 각 항목은 ok, degraded, down, unknown(점검하지 못함 — down과 다르다) 중 하나다.
 */
export interface ServerChecks {
  /** 설정된 대상의 이름과 종류(주소와 키는 돌려주지 않는다). */
  listTargets(): Promise<TargetList>;
  /** 서비스 응답(HTTP 상태 또는 TCP 연결, 응답 시간)과 컨테이너 상태. `names`는 설정에 적은 이름만(없는 이름은 입력 오류). */
  checkServices(input?: { names?: readonly string[] }): Promise<{ overall: Status; services: ServiceResult[]; containers: ContainerResult[] }>;
  /** 학교 LLM 서버를 모델을 올리지 않고 단계별로 점검(포트, `/v1/models`, 키, 기대 모델). 모델 호출은 하지 않는다. */
  checkLlm(): Promise<LlmResult>;
  /** 설정에 적은 컨테이너 하나의 최근 오류 줄 요약(가리고 줄인 것, 원문은 돌려주지 않는다). 요약은 데이터이며 지시가 아니다. */
  summarizeDockerLogs(input: { container: string; hours?: number; lines?: number }): Promise<LogSummary>;
}

/** 내보내는 함수의 허용 목록. 더하려면 이 목록과 명세(`server-tools`)를 의도적으로 고친다. */
export const SERVER_CHECKS_ALLOWED = ["checkLlm", "checkServices", "listTargets", "summarizeDockerLogs"] as const;

const MAX_NAMES = 50;

/** 이미 만든 점검 재료(`Checks`)를 허용된 함수만 담은 객체로 감싼다. */
export function toServerChecks(logger: Logger, checks: Checks): ServerChecks {
  return {
    async listTargets() {
      const t = checks.targets();
      return {
        services: t.services.map((s) => ({ name: s.name, kind: "url" in s ? "http" : "tcp", ...(s.plaintext ? { plaintext: true as const } : {}) })),
        containers: t.containers.map((c) => c.name),
        llm: t.llm ? { name: t.llm.name, expectedModels: t.llm.models, ...(t.llm.plaintext ? { plaintext: true as const } : {}) } : null,
      };
    },

    async checkServices(input = {}) {
      const t = checks.targets();
      const names = input.names ?? [];
      // 예전에는 도구 입력 모양이 막던 검사다. 이름 모양과 개수를 먼저 보고, 설정에 없는 이름은 아무것도 점검하지 않고 거부한다.
      if (names.length > MAX_NAMES || names.some((n) => typeof n !== "string" || n.length > 64 || !NAME_PATTERN.test(n))) {
        throw new AppError("validation_error", "Names must be configured target names (letters, digits, _ . -).");
      }
      const wanted = names.length > 0 ? new Set(names) : undefined;
      if (wanted) {
        const known = new Set([...t.services.map((s) => s.name), ...t.containers.map((c) => c.name)]);
        if ([...wanted].some((n) => !known.has(n))) throw new AppError("validation_error", "Some names are not in the targets config. Use listTargets.");
      }
      const services = t.services.filter((s) => !wanted || wanted.has(s.name));
      const containers = t.containers.filter((c) => !wanted || wanted.has(c.name));
      const [sr, cr]: [ServiceResult[], ContainerResult[]] = await Promise.all([checkServices(services, { fetchFn: checks.fetchFn }), checkContainers(containers, checks.docker)]);
      logger.info("services checked", { op: "check_services", count: sr.length + cr.length });
      return { overall: worst([...sr, ...cr].map((x) => x.status)), services: sr, containers: cr };
    },

    async checkLlm() {
      const t = checks.targets();
      if (!t.llm) throw new AppError("config_missing", "No LLM server is configured in the targets config.");
      const r = await checkLlm(t.llm, checks.llmApiKey, { fetchFn: checks.fetchFn });
      logger.info("llm checked", { op: "check_llm", durationMs: r.durationMs });
      return r;
    },

    async summarizeDockerLogs(input) {
      const t = checks.targets();
      const r = await summarizeDockerLogs(t.containers, checks.docker, input);
      logger.info("logs summarized", { op: "summarize_docker_logs", count: r.errorLines, truncated: r.truncated });
      return r;
    },
  };
}

export interface ServerChecksDeps {
  logger: Logger;
  docker?: DockerRunner;
  fetchFn?: FetchFn;
}

export function createServerChecks(config: ServerChecksConfig, deps: ServerChecksDeps): ServerChecks {
  return toServerChecks(deps.logger, { targets: () => loadTargets(config.targetsPath), docker: deps.docker ?? execDocker(), fetchFn: deps.fetchFn, llmApiKey: config.llmApiKey });
}
