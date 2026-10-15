# Tasks

## 1. 골격: workspace와 shared

- [x] 1.1 루트 `package.json`(private, `workspaces: ["app", "sources/*", "shared"]`, `typecheck`·`lint`·`test`·`build` 스크립트), `tsconfig.base.json`(`moduleResolution: "bundler"`), 공통 eslint·vitest 설정을 만든다. `mcp/`와 `agent/`는 아직 지우지 않는다. 검증: 루트에서 `npm install --ignore-scripts`로 루트 `package-lock.json` 하나가 생기고, `npm run typecheck`가 빈 workspace에서 통과한다
- [x] 1.2 `shared/`(`@morning-desk/shared`)에 `env-file.ts`, logger, `AppError` 바탕을 옮기고, `env-file.test.ts`와 여러 프로세스 동시 쓰기 시험(`env-file-concurrency.test.ts`, `fixtures/env-writer.mjs`)을 함께 옮긴다. 검증: `npm test -w shared`가 통과하고, 동시 쓰기 시험에서 두 키가 모두 마지막 값이다
- [x] 1.3 빈 `sources/folio`가 `shared`를 import 하고, 빈 `app`이 그것을 import 해 tsup로 한 파일에 묶이는지 확인한다(`exports`가 `./src/index.ts`, `noExternal: [/^@morning-desk\//]`). 막히면 design 결정 2의 대안(project references)으로 바꾸고 design에 기록한다. 검증: 루트 `npm run typecheck`, `npm test`, `npm run build -w app`이 통과하고, `node app/dist/index.js --version`이 버전을 출력한다

## 2. 소스 이식: 폴리오로 패턴 굳히기

- [x] 2.1 `mcp/folio`의 로직(`folio/api.ts`, `config.ts`, `errors.ts`)을 `sources/folio`로 옮기고 `createFolioSource(config, deps)`가 `listRecentPapers`, `searchPapers`만 담은 객체를 돌려주게 한다. 도구 입력에 있던 검사(빈 검색어 거부, 결과 상한)를 함수 안으로 옮긴다. 검증: 옮긴 `folio.test.ts`·`privacy.test.ts`가 통과하고, 빈 검색어는 입력 오류, 상한 초과 요청은 상한으로 잘린다
- [x] 2.2 `registry.test.ts`를 `allowlist.test.ts`로 바꾼다: 팩토리가 돌려준 객체의 키가 `FOLIO_ALLOWED`와 정확히 같고 쓰기 이름(`insert*`, `update*`, `delete*`)이 없다. 검증: 테스트가 통과하고, 객체에 아무 함수나 하나 더하면 실패한다
- [x] 2.3 `sources/folio/README.md`를 모듈 사용법(설정 키, 내보내는 함수, 읽기 전용 키 원칙)으로 고친다. 검증: README에 `serve`, MCP 클라이언트 등록 안내가 없다

## 3. 소스 이식: GitHub, 카카오, Gmail, 서버 점검

- [x] 3.1 GitHub: `createGithubSource`가 `listReviewRequests`, `listAssignedItems`, `listNotifications`만 내보내고, 결과 상한을 함수 안에서 적용한다. `auth_status`는 앱의 `auth-status`용 별도 export로 둔다. 검증: 옮긴 `github.test.ts`·`client.test.ts`·`privacy.test.ts`와 새 `allowlist.test.ts`가 통과하고, 모든 함수가 조회 요청만 보낸다는 테스트가 있다
- [x] 3.2 카카오: `createKakaoSource`가 `sendManyToMe`만 내보낸다(받는 사람 인자 없음, `dryRun` 유지). 200자·3통 검사는 지금처럼 `kakao/api.ts`에 둔다. 검증: 옮긴 `send.test.ts`·`auth.test.ts`·`privacy.test.ts`와 `allowlist.test.ts`가 통과하고, 230자는 30자 초과 입력 오류, 4통은 하나도 보내지 않는 입력 오류다
- [x] 3.3 Gmail: `createGmailSource`가 `searchEmails`, `readEmail`만 내보내고, 로그인·로그아웃(`login`, `clear`)은 별도 export(`gmailAuth`)로 둔다. 토큰이 없거나 폐기되면 브라우저 로그인을 시작하지 않고 `auth_required`와 `morning-desk login gmail` 안내를 던진다. 검증: 옮긴 `gmail.test.ts`·`auth.test.ts`·`privacy.test.ts`와 `allowlist.test.ts`가 통과하고, 토큰 폐기 테스트의 오류 메시지에 로그인 명령이 있다
- [x] 3.4 서버 점검: `createServerChecks`가 `listTargets`, `checkServices`, `checkLlm`, `summarizeDockerLogs`만 내보낸다. `check_services` 핸들러에 있던 "설정에 없는 이름 거부"를 함수 안으로 옮긴다. `targets.json` 위치를 `SERVER_TARGETS`(없으면 저장소 루트 기준 `sources/server/targets.json`)로 바꾸고, `targets.example.json`과 `.gitignore` 경로를 옮긴다. 검증: 옮긴 테스트(`config`, `docker`, `llm`, `logs`, `services`, `privacy`, `structure`)와 `allowlist.test.ts`가 통과하고, 설정에 없는 이름은 도커·네트워크 요청 없이 입력 오류이며, `git check-ignore sources/server/targets.json`이 제외 대상으로 알린다
- [x] 3.5 네 소스의 README를 모듈 사용법으로 고친다. 검증: README에 `serve`, `mcp/`, MCP 클라이언트 등록 안내가 없다

## 4. 소스 이식: Microsoft To Do (외부 출처 코드)

- [x] 4.1 `mcp/microsoft-todo`를 `sources/microsoft-todo`로 옮긴다(`LICENSE`, `CHANGELOG.md`, `docs/`, 파일별 출처 주석 유지). `git mv`로 옮겨 이동만 스테이징하고 내용 수정은 스테이징하지 않는다(커밋은 사용자가 요청할 때 이동 커밋과 수정 커밋으로 나눈다). 검증: `git status`가 `src/todo/tasks.ts`를 이름 바꿈(R)으로 보여 주고, `LICENSE`가 있다
- [x] 4.2 `createTodoSource`가 `listTaskLists`, `listTasks`, `getTask`, `listTasksDue`, `createTask`만 내보낸다. `withIdempotency`(같은 실행의 재시도는 처음 결과)를 `createTask` 안으로, `DateTimeInput` 형식 검사와 빈 제목 거부를 함수 입구로 옮긴다. 고친 파일에 "Modified for my-task" 줄을 단다. 검증: 옮긴 `create-unique`, `idempotency`, `due`, `kst`, `tasks-kst`, `pagination`, `graph-client` 테스트가 통과하고, 시간대 없는 "2026-10-13T15:00"이 한국 시간 15:00으로, "2026-10-13"이 10월 13일 마감으로 저장된다
- [x] 4.3 도구 숨김 설정(`--readonly`, `--no-destructive`, `MS_TODO_READONLY`, `MS_TODO_NO_DESTRUCTIVE`, `RiskClass`의 숨김 분기)을 없애고 `--scope-readonly`(읽기 권한만 요청)는 유지한다. 검증: 소스 전체에서 `readonly`·`noDestructive`로 동작을 거르는 코드가 없고, 읽기 전용 권한 테스트(권한 부족 오류, 아무것도 만들지 않음)가 통과한다
- [x] 4.4 토큰이 없을 때 기기 코드 로그인을 스스로 시작하던 동작(`auth/auth-state.ts`의 토큰 요청 경로)을 바꿔, `auth_required`와 `morning-desk login todo` 안내만 던지게 한다. 기기 코드 로그인과 `whoami`·`logout`은 별도 export(`todoAuth`)로 둔다. 검증: `auth-state.test.ts`에 "로그인 전 조회는 로그인을 시작하지 않고 안내를 담은 auth_required"가 있고 통과한다. `token-cache.test.ts`가 통과한다
- [x] 4.5 `registry.test.ts`를 `allowlist.test.ts`로 바꾸고(`sign_in`, `auth_status`가 빠진 다섯 함수), `version.test.ts`를 새 위치에 맞추며, `env-file-same.test.ts`를 지운다. 검증: `npm test -w sources/microsoft-todo`가 통과하고, 수정·완료·삭제 이름의 함수가 없다
- [x] 4.6 README, `CHANGELOG.md`("MCP 서버 층 제거, 모듈로 전환", 숨김 플래그 제거)를 고친다. 크레딧과 기준 커밋은 그대로 둔다. 검증: README에 원본 저장소·기준 커밋·라이선스 안내가 있고 `serve`·MCP 등록 안내가 없다

## 5. 앱 전환: agent/ → app/

- [x] 5.1 `agent/`를 `app/`으로 `git mv`로 옮긴다(이동만 스테이징, 커밋은 사용자가 요청할 때 이동과 수정을 나눈다). 패키지 이름 `@morning-desk/app`, 실행 파일 이름 `morning-desk`. 검증: `git status`가 `app/src/run.ts`를 이름 바꿈(R)으로 보여 주고, `npm run build -w app`이 통과한다
- [x] 5.2 `config.ts`가 `.env.local`을 읽은 환경에서 소스별 `loadConfig`로 설정을 만들고, `run.ts`가 `{ todo, gmail, github, folio, kakao }` 모듈 객체를 받게 한다. `McpPool`, `ToolCaller`, `policy.ts`(`ALLOWED_CALLS`, `guard`)를 지운다. 소스 호출마다 앱 쪽 제한 시간을 감싸는 작은 함수를 둔다(기존 120초). 검증: `app/src`에 `@modelcontextprotocol`, `McpPool`, `caller.call(` 참조가 없고 타입 검사가 통과한다
- [x] 5.3 `briefing/sources.ts`, `todo.ts`, `writes.ts`, `deliver.ts`의 소스 결과 재검증 zod 스키마를 없애고 모듈 타입을 쓴다. `describeFailure`는 모듈이 던진 `AppError` 코드를 그대로 쓴다. 모델 출력 검증(`model/schema.ts`)은 그대로 둔다. 검증: 옮긴 `sources`, `briefing-todo`, `writes`, `report`, `top`, `model` 테스트가 가짜 모듈 객체로 통과하고, 한 소스가 실패해도 나머지로 브리핑이 만들어지며 실패 구역에 원인이 있다
- [x] 5.4 `run.test.ts`, `injection.test.ts`를 가짜 모듈 객체로 바꾸고, `pool.test.ts`와 `fixtures/fake-server.mjs`를 지운다. 드라이런 테스트에 "태스크 추가 함수는 한 번도 불리지 않고, 카톡 전송 함수는 드라이런(검사만 하고 보내지 않음)으로만 불림"을 둔다(드라이런에서도 글자 수 검사를 실제 전송과 같게 하려고 카카오 모듈의 드라이런을 부른다). 검증: `npm test -w app`이 통과하고, 프롬프트 주입 시험에서 추가가 상한 이내다
- [x] 5.5 CLI를 바꾼다: `list-tools`를 없애고 `login <todo|gmail>`, `logout <todo|gmail>`, `auth-status`를 더한다. `auth-status`는 소스별 로그인·설정 상태를 값 없이 보여 준다. `run`, `migrate-tokens`는 그대로다. 검증: CLI 테스트에서 알 수 없는 소스는 오류 코드 2이고, `auth-status` 출력에 `.env.local`의 어떤 값도 없다
- [x] 5.6 앱 전체에서 하루 실행 중 자식 프로세스가 생기지 않는지 확인하는 테스트를 둔다(`child_process`의 실행 함수를 감시). 서버 점검의 도커 호출은 `run`이 쓰지 않으므로 대상이 아니다. 검증: 테스트가 통과하고, 일부러 자식 프로세스를 띄우면 실패한다
- [x] 5.7 `app/README.md`를 새 명령과 구조로 고친다. 검증: README의 명령 예시가 `morning-desk run --dry-run`, `login gmail` 등이고 `mcp/`·`list-tools`가 없다

## 6. 정리와 문서

- [x] 6.1 `mcp/`와 각 패키지의 `package-lock.json`, `node_modules`, `dist`를 지우고 `@modelcontextprotocol/sdk`를 의존성에서 없앤다. 검증: 저장소에 `mcp/` 폴더가 없고 코드·설정에 `@modelcontextprotocol` 참조가 없으며(`sources/microsoft-todo`의 변경 기록과 원본 보관 문서 `docs/upstream/`에만 역사로 남음), 루트에서 `npm ci --ignore-scripts && npm run typecheck && npm run lint && npm test && npm run build -w app`이 통과한다
- [x] 6.2 `AGENTS.md`를 고친다: 구조(`app/`, `sources/`, `shared/`), 명령(루트 workspace 기준), "에이전트·도구·MCP 서버" 표현을 "앱·모듈"로, "planned" 표기 제거, "There is no remote yet"을 `origin`(`jwhitekim/morning-desk`)이 있고 푸시는 요청할 때만 한다로, 허용 목록 규칙을 모듈 기준으로, `retire-veloo-plan` 경로를 보관 위치(`openspec/changes/archive/2026-10-15-retire-veloo-plan`)로. 검증: `AGENTS.md`에 `mcp/`, `planned`, `no remote`가 없고, `retire-veloo-plan`은 보관 위치로만 나온다
- [x] 6.3 루트 `README.md`를 새 구조, 상태, 크레딧 경로(`sources/microsoft-todo/...`)로 고친다. 검증: README의 모든 상대 링크가 실제 파일을 가리킨다
- [x] 6.4 `assistant-app/design.md`에 "결정 기록: MCP 대신 같은 프로세스 모듈(2026-10-15)"을 덧붙인다(결정 1·2의 MCP 표현이 바뀜, 스파이크 2.2를 하게 되면 모듈 위에 래퍼를 만듦). 검증: 기록이 있고 `openspec validate assistant-app --strict`가 통과한다

## 7. 배포 (사용자와 함께, `env-token-store` 작업 6.2 이관)

- [ ] 7.1 집 서버의 지금 코드 폴더를 이름을 바꿔 남기고(되돌리기용) 새 코드를 복사한 뒤, 루트에서 `npm ci --ignore-scripts`와 `npm run build -w app`을 실행한다. 서버의 `.env.local`에 `SERVER_MCP_TARGETS`가 있으면 `SERVER_TARGETS`로 바꾼다. 검증: `node app/dist/index.js --version`이 버전을 출력한다
- [ ] 7.2 `migrate-tokens --dry-run`으로 확인한 뒤 `migrate-tokens`를 실행하고 `auth-status`로 확인한다. 검증: `auth-status`에 To Do·Gmail 로그인과 카카오 설정이 정상으로 나오고, 서버의 옛 토큰 폴더(`~/.config/my-task*`, `~/.config/microsoft-todo-mcp`)가 없으며, `.env.local` 권한이 600이다
- [ ] 7.3 타이머(크론)의 실행 경로를 `agent/dist` → `app/dist`로 바꾸고 `run --dry-run`을 한 번 실행한다. 검증: 드라이런이 실패 구역 없이(또는 원인이 분명한 실패만) 끝나고, 타이머 설정에 `agent/`가 없다
- [ ] 7.4 다음 날 아침 7시 실행 결과를 기록에서 확인한다. 검증: 브리핑이 도착하고, 실행 기록에 자식 프로세스 시작 로그(`server started`)가 없으며 오류가 없다. 문제가 있으면 타이머를 옛 폴더로 되돌린다
