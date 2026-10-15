# Design

## Context

동기는 proposal.md의 Why를 본다. 지금 구조는 다음과 같다.

- `mcp/<이름>/`(microsoft-todo, gmail, kakao, github, folio, server) 여섯 패키지가 각자 `package.json`, lockfile, `node_modules`, `dist`를 가진다. 각 패키지는 세 층으로 나뉜다: 바깥 API를 부르는 로직(`*/api.ts`, `auth/`, `client.ts`, `checks/`, `todo/`), 도구 정의(`tools/*.ts`: zod 입력 모양 + 핸들러 + 위험 등급), MCP 서버와 CLI(`server.ts`, `index.ts`).
- `agent/`는 `McpPool`(`src/mcp/pool.ts`)로 서버마다 `node mcp/<이름>/dist/index.js serve`를 자식 프로세스로 띄우고, `policy.ts`의 문자열 허용 목록(`ALLOWED_CALLS`)으로 한 번 더 막은 뒤, `briefing/*.ts`에서 `caller.call("gmail", "search_emails", …)`로 부르고 결과를 zod로 다시 검증한다.
- `agent`는 실행할 때 `.env.local` 전체를 자기 `process.env`에 읽어 들인다(`src/env.ts`). 자식에는 서버별로 고른 변수만 넘긴다(`config.ts`의 `SERVER_ENV`).
- `env-file.ts`는 네 곳(agent, gmail, kakao, microsoft-todo)에 같은 내용으로 있고 해시 테스트(`microsoft-todo/test/env-file-same.test.ts`)가 같음을 지킨다. logger는 여섯 벌(네 벌은 같은 내용), errors는 여섯 벌(소스마다 오류 코드가 조금씩 다름)이다.
- 입력 검사의 일부가 도구 층에 있다. 이 층을 버리면 함께 사라지므로 옮겨야 한다(결정 5).

## Goals / Non-Goals

**Goals:**
- 결과가 "처음부터 만든 것 같은" 구조이되, 로직과 테스트는 옮겨 심어서 이미 잡은 버그를 다시 겪지 않는다.
- 허용 목록이 소스마다 한 곳에만 있고, 타입과 테스트로 고정된다.
- 옮기는 동안 각 단계에서 타입 검사, 린트, 테스트가 통과하는 상태를 유지한다.

**Non-Goals:**
- 소스의 동작(검색 조건, 중복 방지, 시간대, 말풍선 규칙) 변경.
- MCP 래퍼를 남기는 것, 모델 주도 도구 호출.
- 명세 이름(`*-tools`) 변경, 저장소 전체의 `my-task` 이름 정리.

## Decisions

### 1. 목표 구조와 workspace

```
package.json            # private, "workspaces": ["app", "sources/*", "shared"]
package-lock.json       # 하나뿐
shared/                 # @morning-desk/shared: env-file, logger, 오류 바탕(AppError)
sources/
  microsoft-todo/       # @morning-desk/microsoft-todo (LICENSE, CHANGELOG 유지)
  gmail/  kakao/  github/  folio/  server/
app/                    # @morning-desk/app (지금의 agent/), bin: morning-desk
```

- 패키지 이름은 `@morning-desk/*`이고 모두 `private: true`다(가정: 저장소 이름에 맞춤. 배포하지 않으므로 이름은 내부용). 실행 파일 이름은 `morning-desk`로 한다.
- 대안: 패키지를 하나로 합치기(폴더만 나눔). 기각: 소스별 의존성(`@azure/msal-node`는 To Do만)과 테스트 경계가 흐려지고, "다른 소스의 키를 읽지 않음" 같은 경계를 패키지 단위로 보기 어렵다.
- 대안: pnpm. 기각: 지금 npm을 쓰고 있고 AGENTS.md의 `npm ci --ignore-scripts` 규칙을 그대로 쓸 수 있다.

### 2. 빌드: 앱 하나만 빌드한다

- `sources/*`와 `shared/`는 빌드 단계가 없다. `package.json`의 `exports`·`types`가 `./src/index.ts`를 가리킨다.
- `app/`의 tsup가 workspace 패키지를 함께 묶는다(`noExternal: [/^@morning-desk\//]`). 바깥 의존성(`zod`, `@azure/msal-node`)은 묶지 않고 루트 `node_modules`에서 읽는다.
- 타입 검사는 루트 `tsconfig.base.json`(`moduleResolution: "bundler"`)을 각 패키지가 이어받는다. vitest는 TS를 직접 읽으므로 따로 설정할 것이 없다. 이 조합이 실제로 되는지는 골격 단계(작업 1)에서 가장 작은 패키지로 먼저 확인한다. 안 되면 대안은 TypeScript project references와 패키지별 `tsc -b`다.
- 대안: 패키지마다 지금처럼 tsup로 `dist`를 만듦. 기각: "소스별 사전 빌드가 필요 없다"(source-access 명세)와 맞지 않고, 빌드 안 된 패키지 때문에 실행 중에 실패하던 문제가 남는다.

### 3. 모듈 인터페이스: 허용된 함수만 담은 객체를 돌려주는 팩토리

각 소스는 `src/index.ts`에서 팩토리 하나와 그 타입을 내보낸다.

```ts
// sources/gmail/src/index.ts
export interface GmailSource {
  searchEmails(input: SearchInput): Promise<SearchResult>;
  readEmail(id: string): Promise<ReadResult>;
}
export const GMAIL_ALLOWED = ["readEmail", "searchEmails"] as const;
export function createGmailSource(config: GmailConfig, deps: { logger: Logger; fetch?: typeof fetch }): GmailSource;
```

- 앱은 `{ todo: TodoSource; gmail: GmailSource; github: GithubSource; folio: FolioSource; kakao: KakaoSource }`를 받는다. 테스트는 같은 타입의 가짜 객체를 넘긴다(가짜 MCP 서버 `fake-server.mjs`는 없어진다).
- 허용 목록 테스트(소스마다 `test/allowlist.test.ts`)는 팩토리가 돌려준 객체의 키를 정렬해 허용 목록과 같은지, 금지 이름(`delete*`, `update*`, `complete*`, `send*`(카카오 제외), `trash*` 등)이 없는지 본다. 지금의 `registry.test.ts`를 바꾼 것이다.
- 로그인 함수(`login`, `logout`, `whoami`)는 이 객체에 넣지 않고 별도 export(`gmailAuth` 등)로 두어, 하루 실행 흐름(`run`)이 타입상 로그인 함수를 받지 못하게 한다.
- 앱의 `policy.ts`(`ALLOWED_CALLS`, `guard`)는 없앤다. 앱이 부를 수 있는 것은 받은 객체의 메서드뿐이라 같은 보호가 타입으로 된다. 드라이런에서 쓰기를 막는 것은 지금처럼 `run.ts`가 쓰기 호출(태스크 추가, 카톡 전송)을 하지 않는 방식이고, 카카오는 `dryRun` 인자를 그대로 받는다.
- 대안: 도구 레지스트리(`ToolDef[]`)를 남기고 같은 프로세스에서 이름으로 부르는 `LocalCaller`. 기각: 호출부는 거의 그대로지만 결과가 여전히 `unknown`이라 앱 쪽 zod 재검증과 문자열 허용 목록이 남는다. 이번 변경의 이유(타입 손실, 이중 관리)를 풀지 못한다.

### 4. 결과의 타입이 그대로 흐른다

- 앱의 `briefing/sources.ts`, `todo.ts`, `writes.ts`, `deliver.ts`에서 소스 결과를 다시 검증하던 zod 스키마(`MailSearch`, `MailRead`, `Items(...)`, `Papers`, `ListsAnswer` 등)를 없애고 모듈이 내보낸 타입을 쓴다.
- 모델 출력의 검증(`model/schema.ts`)은 그대로 둔다. 모델 출력은 신뢰할 수 없는 바깥 데이터이기 때문이다.
- 소스 하나의 실패를 실패 구역으로 모으는 처리(`describeFailure`)는 그대로다. 지금은 `AppError("tool_error", …, { toolCode })`로 감싸 코드를 꺼내지만, 이제는 모듈이 던진 `AppError`의 코드를 그대로 쓴다.

### 5. 도구 층에 있던 입력 검사와 재시도 보호를 모듈 함수 안으로 옮긴다

도구 층의 zod 입력 모양은 MCP 경계에서 바깥 입력(모델)을 막던 것이다. 이제 호출자는 우리 코드이고 TS 타입이 대부분을 막지만, **명세가 요구하는 검사**는 모듈 함수 안에 있어야 한다. 하나씩 확인한 결과:

| 명세 요구 | 지금 위치 | 할 일 |
|---|---|---|
| 카카오 200자 초과 거부, 최대 3통 | `kakao/api.ts`(`TEXT_LIMIT`, `MAX_BATCH`) | 그대로(이미 모듈 안) |
| 서버 점검: 설정에 없는 컨테이너 거부 | `server/checks/logs.ts` | 그대로 |
| 서버 점검: 설정에 없는 이름으로 `check_services` 거부 | `server/tools/server-tools.ts` 핸들러 | 모듈 함수로 옮김 |
| To Do 일시 입력(날짜만, 시간대 없음 = 한국 시간) | 형식 검사는 `lib/schema.ts`의 zod(`DateTimeInput`), 변환은 `lib/kst.ts` | 모듈 함수 입구에서 같은 zod 스키마로 검사 |
| To Do 같은 실행의 재시도는 처음 결과를 돌려줌 | `tools/_shared.ts`의 `withIdempotency` | 모듈의 `createTask` 안으로 옮김 |
| 결과 개수 상한(`maxResults` 최대값) | GitHub·폴리오·To Do 도구 입력의 zod | 모듈 함수에서 상한으로 자름(초과 입력은 상한 적용) |
| 빈 제목·빈 검색어 거부 | 도구 입력의 `min(1)` | 모듈 함수 입구에서 입력 오류로 거부 |

옮긴 검사마다 기존 테스트(도구 층 테스트)를 모듈 함수 테스트로 바꿔 옮긴다.

### 6. To Do 로그인: 실행 중에는 기기 코드 로그인을 시작하지 않는다

- 지금 `auth/auth-state.ts`는 토큰이 필요할 때 로그인이 안 되어 있으면 스스로 기기 코드 로그인을 시작하고 그 코드를 오류에 담아 돌려준다(140~146행 부근). 대화형 MCP에서는 편했지만, 정해진 시각에 도는 앱에서는 아무도 보지 않는 로그인이 시작된다.
- 바꾼 뒤: 모듈은 토큰이 없으면 `auth_required`와 "`morning-desk login todo`를 실행하라"는 안내만 던진다. 기기 코드 로그인은 `login todo` 명령만 시작한다. Gmail도 같다(이미 그렇게 동작하는지 옮길 때 확인).
- 앱 CLI: `login <todo|gmail>`, `logout <todo|gmail>`, `auth-status`(각 소스의 로그인·설정 상태를 값 없이 출력). 카카오는 로그인 명령이 없고 `auth-status`에서 설정 여부만 보인다. `migrate-tokens`, `run`은 그대로다. `list-tools`는 없앤다.

### 7. 설정과 비밀

- 앱은 지금처럼 `.env.local`을 `process.env`에 읽은 뒤, 각 소스의 `loadConfig(env)`로 그 소스의 설정만 만들어 팩토리에 넘긴다. 모듈 안에서 `process.env`를 직접 읽지 않는다(테스트가 환경 변수 없이 돌게).
- 자식 프로세스별 환경 분리는 사라진다. 그러나 지금도 앱 프로세스가 모든 값을 갖고 있었으므로 공격 면이 넓어지지는 않는다. 남는 경계는 두 가지다: 모듈은 자기 설정만 받는다, `env-file.ts`의 키 목록으로 자기 토큰 키만 고쳐 쓴다.
- `MY_TASK_ENV_FILE`은 이름 그대로 둔다(범위 밖). 앱이 그 경로(없으면 저장소 루트의 `.env.local`)를 모든 소스에 넘긴다.
- 서버 점검의 `targets.json` 위치는 지금 `process.argv[1]`(서버 실행 파일)에서 계산한다. 앱 안에서는 맞지 않으므로 `SERVER_TARGETS`(지금의 `SERVER_MCP_TARGETS`)가 없으면 저장소 루트 기준 `sources/server/targets.json`으로 정한다. `.gitignore` 경로도 바꾼다.

### 8. 공통 코드: `shared/`

- `env-file.ts`(네 벌 같은 내용), logger(같은 네 벌 기준), `AppError` 바탕을 옮긴다. 소스별 오류 코드는 각 소스의 `errors.ts`에 남기고 바탕만 공유한다.
- 하나가 되므로 해시 테스트(`env-file-same.test.ts`)는 지운다. 여러 프로세스 동시 쓰기 시험(`env-file-concurrency.test.ts`)은 `shared/`로 옮긴다(로그인 명령과 앱이 동시에 쓸 수 있어서 여전히 필요하다).
- To Do의 logger(`lib/logger.ts`)는 외부 출처 코드라 내용이 다르다. 공유 logger로 바꿀 수 있으면 바꾸고 "Modified for my-task" 표시를 단다. 어려우면 그대로 둔다(옮길 때 판단).

### 9. 외부 출처 코드(microsoft-todo)

- `sources/microsoft-todo/`로 옮겨도 `LICENSE`, `CHANGELOG.md`, `docs/`, README 크레딧, 파일별 출처 주석을 유지한다. 옮기기만 한 파일은 주석을 바꾸지 않고, 내용을 고친 파일에만 "Modified for my-task: …" 줄을 더한다.
- 없애는 파일(`server.ts`, `tools/*`, `index.ts`의 `serve`)은 `CHANGELOG.md`에 "MCP 서버 층 제거, 모듈로 전환"으로 적는다.

### 10. 옮기는 순서: 골격 → 가장 작은 소스 → 나머지 → 앱 전환 → 정리

1. 루트 workspace와 `shared/`를 만들고, 빈 패키지 하나로 타입 검사·테스트·앱 번들이 되는지 확인한다.
2. 가장 단순한 폴리오로 패턴을 굳힌다(팩토리, 허용 목록 테스트, 옮긴 테스트).
3. GitHub, 카카오, Gmail, 서버 점검, To Do 순으로 옮긴다(인증이 복잡한 것을 뒤로).
4. `agent/`를 `app/`으로 옮기고, 호출부를 모듈로 바꾸고, `McpPool`·`policy.ts`·가짜 서버를 지운다.
5. `mcp/`를 지우고 문서를 고친다.

옮기는 동안 `mcp/`와 `agent/`는 지우지 않고 두어, 언제든 이전 상태와 비교하거나 되돌릴 수 있게 한다. 각 단계는 커밋 하나(또는 몇 개)로 나눈다.

### 11. 진행 중인 `assistant-app` 문서

`assistant-app/design.md`에 "결정 기록: MCP 대신 같은 프로세스 모듈(2026-10-15)"을 덧붙인다. 결정 1의 "MCP 서버들을 표준입출력 자식 프로세스로 띄운다"와 결정 2의 "MCP 도구" 표현이 이 변경으로 바뀌었다고 적고, 스파이크 2.2(모델 주도 도구 호출)를 하게 되면 그때 모듈 위에 래퍼를 만든다고 남긴다. 그 변경의 명세(`daily-briefing`, `schedule-detection`)는 MCP를 언급하지 않아 고칠 필요가 없다.

## Risks / Trade-offs

- [workspace 패키지를 TS 소스 그대로 import 하는 조합(tsc + vitest + tsup)이 설정 문제로 막힐 수 있다] → 골격 단계에서 가장 먼저 확인하고, 막히면 project references로 바꾼다(결정 2).
- [도구 층을 버리면서 입력 검사나 재시도 보호가 조용히 빠질 수 있다] → 결정 5의 표를 작업으로 하나씩 옮기고, 각 명세 시나리오에 대응하는 테스트가 옮겨졌는지 확인한다.
- [한 프로세스라서 한 모듈의 처리되지 않은 예외나 멈춤이 앱 전체를 멈출 수 있다] → 지금도 앱이 소스별 실패를 잡아 실패 구역으로 보낸다. 바깥 호출마다 제한 시간을 두는 기존 클라이언트 코드를 그대로 쓰고, 소스 호출마다 앱 쪽 제한 시간(지금 `McpPool`의 120초)을 감싸는 작은 함수로 남긴다.
- [자식 프로세스별 환경 분리가 사라진다] → 결정 7. 앱이 이미 모든 값을 갖고 있어 실질 변화는 작다.
- [Claude Code 등에서 소스를 도구로 쓰던 길이 없어진다] → 지금 등록된 곳이 없다. 필요해지면 모듈 위에 얇은 MCP 래퍼를 별도 변경으로 만든다.
- [폴더 이동으로 git 기록 추적이 끊겨 보일 수 있다] → 이동과 내용 수정을 다른 커밋으로 나눠 `git log --follow`가 이어지게 한다.
- [집 서버의 타이머가 옛 경로(`agent/dist`)를 가리킨 채 남는다] → 배포 작업에서 타이머 명령을 함께 고치고, 다음 날 아침 실행을 확인한다.

## Migration Plan

1. 맥북에서 결정 10의 순서로 옮기고, 매 단계 루트에서 `npm run typecheck && npm run lint && npm test`, 마지막에 `npm run build -w app`이 통과하게 한다.
2. 맥북에서 `morning-desk auth-status`로 로그인·설정 상태를 확인한다(값은 출력하지 않음). 드라이런은 맥북에서 하지 않는다(맥북에서 토큰을 갱신하면 집 서버 토큰과 엇갈릴 수 있다는 이전 결정을 따른다).
3. 사용자와 함께 집 서버에 배포한다: 코드 복사, 루트에서 `npm ci --ignore-scripts`, `npm run build -w app`, `migrate-tokens`, 타이머 명령을 `app/dist`로 변경, 드라이런, 다음 날 아침 7시 실행 확인, 옛 토큰 폴더 삭제 확인(보관된 `env-token-store`의 작업 6.2를 이관).
4. 되돌리기: 배포 전 집 서버의 이전 코드 폴더를 이름을 바꿔 남겨 두고, 문제가 있으면 타이머를 옛 경로로 돌린다. `.env.local`의 키 이름은 바뀌지 않으므로 토큰은 양쪽에서 같이 쓸 수 있다.

## Open Questions

- (구현 때 정함, 2026-10-15) To Do의 logger는 원본 그대로 둔다. 원본 로거는 정해진 키의 값을 가리는 방식이고 Graph 클라이언트가 `traceId`·`requestId` 같은 필드를 쓰므로, 허용 필드만 남기는 공용 로거로 바꾸면 외부 출처 코드를 여러 군데 고쳐야 한다. 그래서 `createTodoSource`는 앱의 공용 로거를 받지 않고 설정의 로그 수준으로 원본 로거를 만든다.
- (구현 때 정함) 앱의 번들은 소스 모듈의 바깥 의존성(`@azure/msal-node`, `zod`)을 `external`로 둔다. CommonJS 패키지를 ESM 한 파일에 묶으면 동적 `require`가 깨지는 것을 빌드 뒤 실행에서 확인했다.
