# my-task / microsoft-todo MCP 서버

[`my-task`](../../README.md)의 **태스크 연결 부분**입니다. Microsoft To Do를 MCP(Model Context Protocol) 도구로 내놓아서, 에이전트가 내 태스크를 읽고 새 태스크를 추가할 수 있게 합니다. 에이전트 자체와 다른 데이터 소스(Gmail, GitHub, 폴리오)는 이후 단계에서 다룹니다.

## 출처 (Credits)

이 프로젝트의 MCP 서버 코드는 아래 오픈소스를 바탕으로 합니다.

- **[fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)** — © 2026 Fabien Butz, MIT 라이선스
- 가져온 기준 커밋: `83d8f44c6a74924acf2c7c5861d3c4d24e852d21`
- 원본 라이선스는 [`LICENSE`](LICENSE)에 그대로 있고, 가져온 소스 파일 상단에도 출처 주석이 있습니다.
- 원본 대비 바꾼 점은 [`CHANGELOG.md`](CHANGELOG.md)에 있습니다. 원본 문서 중 일부는 [`docs/upstream/`](docs/upstream/)에 출처 표시와 함께 보관했습니다.

원작자의 코드를 바탕으로 했을 뿐 원작자가 이 프로젝트를 보증하거나 관여하지 않습니다.

## 하는 일

| 도구 | 종류 | 설명 |
|---|---|---|
| `auth_status`, `sign_in` | 인증 | 로그인 상태 확인, 기기 코드 방식 로그인 |
| `list_task_lists` | 읽기 | To Do 목록 조회 |
| `list_tasks`, `get_task` | 읽기 | 태스크 조회 |
| `list_tasks_due` | 읽기 | 모든 목록에서 마감이 `from`~`to`(한국 날짜)인 미완료 태스크를 마감 순으로 조회. `includeOverdue`로 밀린 일 포함, 기본 200개 한도(최대 1000)와 잘림 표시(`truncated`, `omitted`), 읽지 못한 목록은 `failedLists`에 표시 |
| `create_task` | 쓰기 | 태스크 추가(제목, 본문, 마감 일시, 알림 일시, 중요도, 카테고리). 중복이면 만들지 않음 |

**일부러 없는 것**: 태스크 수정, 완료 처리, 삭제, 목록 생성·수정·삭제, 체크리스트. 에이전트에게는 읽기와 추가만 주고, 도구가 코드에 존재하지 않으면 모델이 실수로도 부를 수 없다는 원칙입니다(`test/registry.test.ts`가 도구 목록을 허용 목록으로 고정합니다). 필요해지면 그때 의도적으로 추가합니다.

## 중복 방지

`create_task`는 만들기 전에 같은 목록의 **미완료** 태스크를 조회해서, 이름(앞뒤 공백 제거, 대소문자 무시)과 마감 날짜(한국)가 같은 것이 있으면 새로 만들지 않고 기존 태스크를 `alreadyExisted: true`로 돌려줍니다. 마감이 없는 태스크끼리는 이름만 같으면 같은 것으로 봅니다. 서버 상태를 보고 판단하므로 프로그램을 다시 시작해도 지켜집니다. 같은 실행 안의 짧은 재시도는 기존의 메모리 캐시(60초)도 막아 줍니다. 기존 태스크를 읽지 못하면 안전하게 아무것도 만들지 않고 오류를 돌려줍니다.

## 시간 규칙 (한국 표준시)

- **마감은 날짜만 저장됩니다.** 날짜만 주면(`2026-10-13`) 그 한국 날짜가 마감입니다. 시각을 붙여 줘도 한국 날짜만 쓰이고 시각은 버려집니다(`2026-10-13T00:30` → 10월 13일). Graph가 마감의 시각을 버리고 "보낸 시간대 기준의 날짜"만 저장하는 것을 실측했기 때문에, 한국 날짜를 `Asia/Seoul` 자정으로 보냅니다. UTC로 바꿔 보내면 하루 어긋납니다.
- **알림은 시각이 그대로 저장됩니다.** 시간대 표시 없는 일시(`2026-10-13T09:00`)는 한국 시간입니다. `+09:00`, `Z`, `{dateTime, timeZone}`을 주면 그대로 따릅니다.
- 조회 결과의 `dueDateTime`, `reminderDateTime`, `completedDateTime`은 한국 시간(`Asia/Seoul`)으로 바뀌어 나오고, 마감은 `dueDate`(YYYY-MM-DD)가 함께 붙습니다. 실측: 앱에서 날짜만 고른 마감은 Graph에서 전날 15:00 UTC로 오므로, 그대로 날짜만 자르면 하루 전으로 보입니다.
- 알 수 없는 시간대의 태스크는 목록 전체를 실패시키지 않고 그 태스크에 `timeWarning`을 붙입니다.

## 실행

이 폴더(`mcp/microsoft-todo/`) 안에서 합니다.

```bash
cd mcp/microsoft-todo
npm ci --ignore-scripts   # 잠금 파일 그대로 설치, 의존 패키지의 설치 스크립트는 실행하지 않음
npm run build
npm test
```

Node 20 이상. 처음 실행하면 기기 코드 로그인 안내가 나오고, 토큰은 `~/.config/microsoft-todo-mcp/token-cache.json`에 파일 권한 600으로 저장됩니다. 읽기 전용으로만 쓰려면 `MS_TODO_READONLY=1`(쓰기 도구 숨김) 또는 `MS_TODO_SCOPE_READONLY=1`(`Tasks.Read` 권한만 요청)을 씁니다.

기본 클라이언트는 Microsoft의 Graph 명령줄 도구용 공개 클라이언트입니다. 본인 앱 등록으로 바꾸려면 [`docs/upstream/ENTRA-APP-SETUP.md`](docs/upstream/ENTRA-APP-SETUP.md)를 보고 `MS_TODO_CLIENT_ID`를 지정합니다.

## 개발 규칙

작업은 OpenSpec(`openspec/`)으로 관리합니다. 계획서(`/opsx:propose`)를 쓰고 검토를 받은 뒤 구현합니다. 비밀값은 저장소에 넣지 않습니다.
