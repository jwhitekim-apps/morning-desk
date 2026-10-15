# Changelog

이 프로젝트의 변경 기록입니다. 원본(upstream)은 [fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)의 커밋 `83d8f44c6a74924acf2c7c5861d3c4d24e852d21`(v0.2.0)이고, 아래는 **원본 대비 바꾼 점**입니다.

## 미출시 (0.0.1 이후)

### 추가
- `list_tasks_due` 도구(읽기): 모든 목록의 미완료 태스크를 한국 날짜 범위로 모아 마감 순으로 돌려줍니다. 밀린 일 포함 옵션, 한도(기본 200, 최대 1000)와 잘림 표시, 목록 동시 조회 4개 제한, 실패한 목록 표시. `src/todo/due.ts`.
- `src/lib/kst.ts`: 한국 표준시 변환(날짜만 → 한국 자정, 시간대 없는 일시 → 한국 시간, 응답의 UTC → 한국 시간). 속성 기반 테스트 포함.
- `TasksApi.listOpen()`, `TasksApi.createUnique()`, `list()`의 `excludeCompleted` 옵션.

### 변경
- `create_task`: 같은 목록에 이름(공백 제거, 대소문자 무시)과 마감 날짜가 같은 미완료 태스크가 있으면 만들지 않고 기존 것을 `alreadyExisted: true`로 돌려줍니다. 원본의 메모리 캐시는 그대로입니다.
- 조회·추가 응답의 마감·알림·완료 일시를 한국 시간으로 바꾸고 `dueDate`를 더했습니다. 알림 일시는 한국 시간을 UTC로 계산해 보내고(원본은 서버 컴퓨터의 시간대를 썼습니다), 마감은 한국 날짜를 `Asia/Seoul` 자정으로 보냅니다. 실측: Graph는 마감의 시각을 버리고 보낸 시간대 기준의 날짜만 저장합니다(UTC로 보낸 한국 자정은 하루 전 날짜로 저장되어 중복 방지도 어긋났습니다). `src/lib/schema.ts`, `src/todo/tasks.ts`, `src/tools/task-tools.ts`, `src/tools/_shared.ts`, `src/server.ts` 수정.
- `test/registry.test.ts`: 허용 목록에 `list_tasks_due` 추가.

### 보안 점검 (`npm audit`, 2026-10-10)
- `npm audit fix --ignore-scripts`(호환 범위 안의 갱신만)를 **적용**했습니다. 설치된 `@modelcontextprotocol/sdk` 1.29.0 → 1.32.1과 그에 딸린 hono, qs, ip-address, proxy-addr, body-parser 등 18개를 올리고 2개를 더했습니다. 적용 뒤 타입 검사, 린트, 테스트 73개, 빌드가 통과했고, 실계정 읽기 전용 호출(`list_tasks_due`)도 같은 결과였습니다.
- 운영 의존성 경고는 10건(치명 1, 높음 4)에서 **2건(보통)** 으로 줄었습니다. 남은 것은 `@azure/msal-node`가 쓰는 `uuid`(v3/v5/v6에 버퍼를 직접 줄 때의 범위 검사 누락)이고, 이 프로젝트는 그 경로를 쓰지 않습니다. 고치려면 `@azure/msal-node` 7(큰 버전 변경)이 필요한데 로그인과 토큰 보관을 건드리므로 **적용하지 않았습니다.** 별도 변경으로 다룹니다.
- 개발 도구 경고 6건(`vitest`, `vite`, `tinypool`, `esbuild` 계열, 일부 치명)이 남았습니다. 테스트 실행 때만 쓰이고 배포물(`dist/`)에는 들어가지 않으며, 고치려면 `vitest` 4(큰 버전 변경)가 필요해서 적용하지 않았습니다. 테스트는 신뢰하는 코드와 모의 데이터로만 돌립니다.

## 0.0.1 (원본 v0.2.0 기준)

### 제거
- 도구: `update_task`, `complete_task`, `delete_task`, `create_task_list`, `update_task_list`, `delete_task_list`, 체크리스트 도구 4개(`src/tools/checklist-tools.ts` 삭제). 에이전트에게는 읽기와 태스크 추가만 줍니다.
- 원본의 운영 파일: `.github/`(CI, Dependabot), `CONTRIBUTING.md`, `SECURITY.md`, 원본 `CHANGELOG.md`, 원본 `README.md`, `docs/INSTALL-WINDOWS.md`.

### 변경
- `test/registry.test.ts`: 도구 개수 검사 대신 **허용 목록과 정확히 같은지**, 위험(destructive) 도구가 없는지, 수정·삭제 도구 이름이 없는지를 검사합니다.
- `package.json`: 이름을 `my-task-todo-mcp`로, 버전 `0.0.1`, `private: true`, 원본의 `homepage`, `bugs`, `repository`, `keywords` 제거, `bin` 이름 변경.
- `src/version.ts`: 버전 문자열을 `0.0.1`로(`package.json`과 같아야 한다는 원본 테스트 때문).
- 가져온 소스와 테스트 파일 상단에 출처 주석을 추가했고, 수정한 파일에는 수정 내용을 적었습니다.
- 원본의 `docs/ARCHITECTURE.md`, `docs/ENTRA-APP-SETUP.md`는 `docs/upstream/`로 옮기고 출처 안내를 맨 위에 붙였습니다.

### 그대로 둔 것
- 인증(기기 코드, MSAL 토큰 캐시), Graph 클라이언트, 페이지 넘김, 멱등성 처리, 로거, 서버 조립, 설정 환경 변수.
