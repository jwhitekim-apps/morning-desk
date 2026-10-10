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
| `create_task` | 쓰기 | 태스크 추가(제목, 본문, 마감 일시, 알림 일시, 중요도, 카테고리) |

**일부러 없는 것**: 태스크 수정, 완료 처리, 삭제, 목록 생성·수정·삭제, 체크리스트. 에이전트에게는 읽기와 추가만 주고, 도구가 코드에 존재하지 않으면 모델이 실수로도 부를 수 없다는 원칙입니다(`test/registry.test.ts`가 도구 목록을 허용 목록으로 고정합니다). 필요해지면 그때 의도적으로 추가합니다.

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
