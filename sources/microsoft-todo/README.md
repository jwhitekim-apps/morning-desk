# morning-desk / microsoft-todo 소스 모듈

[`morning-desk`](../../README.md) 앱의 **태스크 연결 부분**입니다. 앱이 같은 프로세스에서 import 해서, 내 태스크를 읽고 새 태스크를 추가합니다. 원본은 MCP 서버였지만 이 프로젝트에서는 MCP 층을 걷어 내고 모듈로 씁니다(`CHANGELOG.md`).

## 출처 (Credits)

이 모듈의 코드는 아래 오픈소스(MCP 서버)를 바탕으로 합니다.

- **[fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)** — © 2026 Fabien Butz, MIT 라이선스
- 가져온 기준 커밋: `83d8f44c6a74924acf2c7c5861d3c4d24e852d21`
- 원본 라이선스는 [`LICENSE`](LICENSE)에 그대로 있고, 가져온 소스 파일 상단에도 출처 주석이 있습니다.
- 원본 대비 바꾼 점은 [`CHANGELOG.md`](CHANGELOG.md)에 있습니다. 원본 문서 중 일부는 [`docs/upstream/`](docs/upstream/)에 출처 표시와 함께 보관했습니다.

원작자의 코드를 바탕으로 했을 뿐 원작자가 이 프로젝트를 보증하거나 관여하지 않습니다.

## 하는 일

`createTodoSource(config)`가 아래 다섯 함수만 담은 객체를 돌려줍니다. 로그인·로그아웃·계정 확인은 앱의 명령(`login todo`, `logout todo`, `auth-status`)이 `todoAuth`로 합니다.

| 함수 | 종류 | 설명 |
|---|---|---|
| `listTaskLists()` | 읽기 | To Do 목록 조회 |
| `listTasks({ listId, ... })`, `getTask({ listId, taskId })` | 읽기 | 태스크 조회 |
| `listTasksDue({ from, to, includeOverdue?, maxResults? })` | 읽기 | 모든 목록에서 마감이 `from`~`to`(한국 날짜)인 미완료 태스크를 마감 순으로 조회. `includeOverdue`로 밀린 일 포함, 기본 200개 한도(최대 1000)와 잘림 표시(`truncated`, `omitted`), 읽지 못한 목록은 `failedLists`에 표시 |
| `createTask({ listId, title, ... })` | 쓰기 | 태스크 추가(제목, 본문, 마감 일시, 알림 일시, 중요도, 카테고리). 중복이면 만들지 않음. 빈 제목과 형식이 틀린 일시는 입력 오류 |

**일부러 없는 것**: 태스크 수정, 완료 처리, 삭제, 목록 생성·수정·삭제, 체크리스트. 앱에는 읽기와 추가만 주고, 함수가 내보내지지 않으면 앱이 실수로도 부를 수 없다는 원칙입니다(`test/allowlist.test.ts`가 함수 목록을 허용 목록으로 고정합니다). 함수를 감추거나 드러내는 실행 설정은 없습니다. 필요해지면 그때 의도적으로 추가합니다.

## 중복 방지

`createTask`는 만들기 전에 같은 목록의 **미완료** 태스크를 조회해서, 이름(앞뒤 공백 제거, 대소문자 무시)과 마감 날짜(한국)가 같은 것이 있으면 새로 만들지 않고 기존 태스크를 `alreadyExisted: true`로 돌려줍니다. 마감이 없는 태스크끼리는 이름만 같으면 같은 것으로 봅니다. 서버 상태를 보고 판단하므로 프로그램을 다시 시작해도 지켜집니다. 같은 실행 안의 짧은 재시도는 기존의 메모리 캐시(60초)도 막아 줍니다. 기존 태스크를 읽지 못하면 안전하게 아무것도 만들지 않고 오류를 돌려줍니다.

## 시간 규칙 (한국 표준시)

- **마감은 날짜만 저장됩니다.** 날짜만 주면(`2026-10-13`) 그 한국 날짜가 마감입니다. 시각을 붙여 줘도 한국 날짜만 쓰이고 시각은 버려집니다(`2026-10-13T00:30` → 10월 13일). Graph가 마감의 시각을 버리고 "보낸 시간대 기준의 날짜"만 저장하는 것을 실측했기 때문에, 한국 날짜를 `Asia/Seoul` 자정으로 보냅니다. UTC로 바꿔 보내면 하루 어긋납니다.
- **알림은 시각이 그대로 저장됩니다.** 시간대 표시 없는 일시(`2026-10-13T09:00`)는 한국 시간입니다. `+09:00`, `Z`, `{dateTime, timeZone}`을 주면 그대로 따릅니다.
- 조회 결과의 `dueDateTime`, `reminderDateTime`, `completedDateTime`은 한국 시간(`Asia/Seoul`)으로 바뀌어 나오고, 마감은 `dueDate`(YYYY-MM-DD)가 함께 붙습니다. 실측: 앱에서 날짜만 고른 마감은 Graph에서 전날 15:00 UTC로 오므로, 그대로 날짜만 자르면 하루 전으로 보입니다.
- 알 수 없는 시간대의 태스크는 목록 전체를 실패시키지 않고 그 태스크에 `timeWarning`을 붙입니다.

## 설치, 테스트, 로그인

설치와 검사는 저장소 루트에서 합니다(npm workspace). 이 모듈은 따로 빌드하지 않고, 앱을 빌드할 때 함께 묶입니다.

```bash
npm ci --ignore-scripts   # 잠금 파일 그대로 설치, 의존 패키지의 설치 스크립트는 실행하지 않음
npm test -w sources/microsoft-todo
npm run build -w app
node app/dist/index.js login todo   # 기기 코드 로그인(한 번)
```

Node 20 이상. 로그인은 `login todo` 명령으로만 시작합니다. 하루 실행 중에 로그인되어 있지 않거나 세션이 끊겼으면 로그인을 시작하지 않고 `auth_required`/`auth_expired`와 `morning-desk login todo` 안내를 던집니다. 토큰 캐시는 루트 `.env.local`(권한 600)의 `MS_TODO_TOKEN_CACHE_DATA` 한 줄(base64)에 저장되고, `logout todo`는 그 줄을 지웁니다. 저장 위치는 `MY_TASK_ENV_FILE`, 없으면 저장소 루트의 `.env.local`입니다. 파일 끝의 `# --- 토큰 (자동 갱신, 직접 고치지 마세요)` 구역은 모듈이 고쳐 쓰므로 손으로 고치지 않습니다. 예전처럼 홈 폴더에 토큰 파일이 남아 있으면 앱의 `migrate-tokens`(먼저 `--dry-run`)로 옮깁니다. 읽기 권한만 쓰려면 `MS_TODO_SCOPE_READONLY=1`(`Tasks.Read` 권한만 요청, 다시 로그인 필요)을 씁니다. 그러면 `createTask`는 권한 부족 오류가 됩니다.

기본 클라이언트는 Microsoft의 Graph 명령줄 도구용 공개 클라이언트입니다. 본인 앱 등록으로 바꾸려면 [`docs/upstream/ENTRA-APP-SETUP.md`](docs/upstream/ENTRA-APP-SETUP.md)를 보고 `MS_TODO_CLIENT_ID`를 지정합니다.

## 개발 규칙

작업은 OpenSpec(`openspec/`)으로 관리합니다. 계획서(`/opsx:propose`)를 쓰고 검토를 받은 뒤 구현합니다. 비밀값은 저장소에 넣지 않습니다.
