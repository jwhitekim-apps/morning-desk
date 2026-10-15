# Proposal

## Why

`mcp/` 아래의 여섯 소스는 stdio MCP 서버로 만들었다. 그러나 비서 앱은 모델에게 도구를 맡기지 않고 **코드가 정해진 순서로** 호출하며(`assistant-app` 결정 2), 사용하는 쪽도 앱 하나뿐이다. 그래서 MCP의 이점(모델이 도구를 고름, 여러 클라이언트가 공유)은 쓰이지 않고, 매일 실행마다 자식 프로세스 다섯 개, 결과의 문자열 변환과 재파싱(타입 손실), 서버별 사전 빌드, 같은 코드의 복사(`env-file.ts` 4벌, logger·errors 여러 벌)라는 비용만 든다. 서브에이전트 3명의 검토(HYBRID 3:0)와 웹 조사도 "코드가 호출을 정하면 직접 호출이 맞다"로 모였고, 사용자는 MCP를 완전히 빼고 모듈로 바꾸기로 정했다. 또한 이 프로그램은 스스로 도구를 고르는 "에이전트"가 아니라 정해진 시각에 도는 **애플리케이션**이므로 이름도 그에 맞춘다. 앱을 본운영에 올리기(병행 운영) 전에 바꾸는 편이 비용이 적다.

## What Changes

- **방식: 새 골격 + 검증된 부품 이식.** 처음부터 다시 쓰지 않는다. 코드의 약 82%(API·인증·브리핑 로직, 약 6,500줄)와 테스트(약 6,200줄)는 그대로 옮기고, MCP 층(약 1,450줄)만 버린다.
- **BREAKING** 새 골격: 저장소 루트를 npm workspace로 만들고 `app/`(지금의 `agent/`), `sources/<이름>/`(지금의 `mcp/<이름>/`), `shared/`(공통 코드)로 나눈다.
- **BREAKING** 여섯 소스(microsoft-todo, gmail, kakao, github, folio, server)를 앱이 같은 프로세스에서 import 하는 **모듈**로 바꾼다. 각 모듈은 허용된 함수만 담은 좁은 인터페이스를 내보낸다(예: Gmail은 메일 검색과 본문 읽기).
- **BREAKING** MCP를 제거한다: 각 소스의 MCP 서버(`server.ts`, `serve` 명령, 도구 등록, `@modelcontextprotocol/sdk`), 앱의 `McpPool`·`policy.ts`·`list-tools` 명령. 나중에 Claude Code 등에서 쓰고 싶어지면 모듈 위에 얇은 래퍼를 별도 변경으로 만든다.
- 허용 목록을 **한 곳**으로 모은다: 모듈이 내보내는 함수 목록과 그것을 고정하는 테스트. 앱의 문자열 허용 목록과 서버별 도구 레지스트리의 이중 관리를 없앤다.
- 소스 결과가 타입 그대로 앱에 전달되므로, 앱 쪽에서 소스 결과를 다시 검증하던 zod 스키마를 없앤다(모델 출력의 스키마 검증은 그대로 둔다).
- 로그인 관련 명령을 앱 CLI로 모은다(`login <소스>`, `logout <소스>`, `auth-status`). To Do의 `sign_in`·`auth_status` 도구는 사라진다. 하루 실행 중에는 로그인을 시작하지 않고 실패로 알린다.
- To Do에 남은 도구 숨김 플래그(`--readonly`, `--no-destructive`, `MS_TODO_READONLY`, `MS_TODO_NO_DESTRUCTIVE`)를 없앤다. 읽기 전용 **권한** 요청(`--scope-readonly`)은 유지한다.
- 같은 코드(`env-file.ts`, logger, 공통 오류 바탕)를 `shared/` 하나로 모으고, lockfile과 `node_modules`를 루트 하나로 합친다. `env-file-same` 해시 테스트는 없앤다.
- 이름: 폴더 `agent/` → `app/`, 문서의 "에이전트·도구" 표현을 "앱·모듈"로 고친다. 명세 이름(`*-tools`)은 이번에 바꾸지 않는다.
- `AGENTS.md`, `README.md`, 각 소스 README를 새 구조로 고친다.
- 집 서버 배포를 이 변경의 마지막 작업으로 둔다(보관된 `env-token-store`의 남은 작업 6.2를 이관).
- **범위 밖**: 서버 상태 점검(`server`)을 브리핑에 연결하는 일, 모델 주도 도구 호출(스파이크 2.2), 명세 이름 변경, 저장소 전체의 `my-task` 이름 정리(`MY_TASK_ENV_FILE` 포함), 남아 있는 `veloo-tools` 명세 정리, 소스의 동작(검색 조건, 중복 방지, 시간대 처리 등) 변경.

## Capabilities

### New Capabilities
- `source-access`: 앱이 소스 모듈을 같은 프로세스에서 직접 호출하는 방식, 허용된 함수만 담은 인터페이스와 그것을 고정하는 테스트, 숨김 설정 금지, 소스별 비밀의 범위, 로그인 명령의 위치를 정한다.

### Modified Capabilities
- `microsoft-todo-tools`: 로그인이 도구에서 앱 명령으로 바뀌고, 읽기 전용 실행 설정(도구 숨김)이 사라지며, 허용 목록이 모듈이 내보내는 동작 기준으로 바뀐다.
- `gmail-tools`: 허용 목록이 모듈이 내보내는 동작 기준으로 바뀌고, 로그인이 앱 명령이 된다.
- `kakao-send-tools`: 허용 목록이 모듈이 내보내는 동작 기준으로 바뀐다.
- `github-tools`: 허용 목록과 "읽기 전용 설정이 쓰기 도구를 숨김" 시나리오가 모듈 기준(쓰기 동작이 코드에 없음)으로 바뀐다.
- `folio-tools`: 허용 목록이 모듈이 내보내는 동작 기준으로 바뀐다.
- `server-tools`: 허용 목록과 입력 정의가 모듈 함수 기준으로 바뀐다.
- `token-env-file`: "MCP 서버"가 "소스 모듈"로, "비서가 띄운 서버" 시나리오가 "경로를 설정한 실행"으로 바뀐다.

## Impact

- 코드: `mcp/*` 전부(이동과 MCP 층 삭제), `agent/` 전부(`app/`으로 이동, `mcp/pool.ts`·`policy.ts` 삭제, `config.ts`·`index.ts`·`briefing/*`·`run.ts` 호출부 수정), `agent/test/*`(가짜 MCP 서버 대신 가짜 모듈). 루트에 workspace용 `package.json`과 lockfile 하나, `shared/`가 생긴다. `.gitignore`의 `mcp/server/targets.json` 경로가 바뀐다.
- 의존성: `@modelcontextprotocol/sdk` 제거. 그 외는 그대로다.
- 운영: 집 서버는 루트에서 `npm ci --ignore-scripts` 한 번, 빌드는 앱 하나만 한다. 타이머(크론)의 실행 경로가 `agent/dist` → `app/dist`로 바뀐다. `.env.local`의 키 이름은 바뀌지 않는다. 로그인 명령의 경로가 바뀐다(예: `node mcp/gmail/dist/index.js login` → 앱의 `login gmail`).
- 보안: 지금도 앱 프로세스가 `.env.local` 전체를 읽으므로 비밀이 앱 프로세스에 모이는 것은 같다. 사라지는 것은 자식 프로세스별 환경 변수 분리다. 각 모듈은 자기 설정만 받고, `.env.local`의 자기 키만 고쳐 쓰는 규칙은 유지한다.
- 진행 중인 변경과의 관계: `env-token-store`는 2026-10-15에 보관되었다(남은 집 서버 적용은 이 변경으로 이관). `assistant-app`의 결정 1(MCP 서버를 자식 프로세스로 띄움)과 "MCP 도구" 표현이 바뀌므로 그 문서에 결정 기록을 덧붙인다.
- 외부 출처 코드: `microsoft-todo`는 `fabienbutz/microsoft-todo-mcp`(MIT)에서 가져온 코드다. 폴더를 옮겨도 `LICENSE`, 파일별 출처 주석, README 크레딧, `CHANGELOG.md`를 유지하고, 고친 파일에는 "Modified for my-task" 표시를 단다.
