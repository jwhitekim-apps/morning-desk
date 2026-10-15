// my-task original code (not derived from upstream).
import type { Targets } from "../config";
import type { DockerRunner } from "./docker";
import type { FetchFn } from "./services";

/** 점검 함수가 쓰는 재료. 설정은 함수를 부를 때마다 읽는다(설정 오류도 그때 알린다). */
export interface Checks {
  targets: () => Targets;
  docker: DockerRunner;
  fetchFn?: FetchFn;
  /** 학교 모델 서버의 키(`LOCAL_LLM_API_KEY`). 결과와 로그에 나오지 않는다. */
  llmApiKey: string | undefined;
}
