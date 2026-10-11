# Proposal

## Why

지금 로그인 토큰이 MCP 서버마다 홈 폴더 아래 다른 폴더(`~/.config/microsoft-todo-mcp/`, `my-task-gmail-mcp/`, `my-task-kakao-mcp/`, `my-task-veloo-mcp/`)에 흩어져 있다. 집 서버로 배포할 때 이 폴더들을 하나하나 옮겨야 했고, 컴퓨터마다 어디에 무엇이 있는지 알기 어렵다. 사용자는 **비밀값과 토큰을 저장소 루트의 `.env.local` 한 곳**에서 관리하기를 원한다. 다만 To Do와 카카오 토큰은 쓸 때마다 새 값으로 바뀌어 다시 저장되어야 하므로, 서버가 `.env.local`의 자기 줄을 안전하게 고쳐 쓰는 규칙이 필요하다.

## What Changes

- **토큰을 루트 `.env.local`에 저장한다.** 서버마다 정해진 키 하나에만 쓴다.
  - To Do: `MS_TODO_TOKEN_CACHE_DATA` (MSAL 토큰 캐시, 한 줄로 인코딩)
  - Gmail: `GMAIL_REFRESH_TOKEN` (액세스 토큰은 실행 중 메모리에만)
  - 카카오: `KAKAO_REFRESH_TOKEN` (지금도 시작 값으로 쓰는 키. 갱신으로 새 값이 오면 이 줄을 고쳐 쓴다)
  - 벨루: `VELOO_SESSION` (세션 쿠키)
- **쓰는 규칙을 하나로 정한다**: 자기 키의 줄만 바꾸고 다른 줄과 주석, 순서는 그대로 둔다. 잠금으로 동시에 쓰는 일을 막고, 임시 파일에 쓴 뒤 바꿔치기해서 깨진 파일이 남지 않게 한다. 파일 권한은 600을 유지한다. 값은 로그와 응답에 나오지 않는다.
- **위치는 `MY_TASK_ENV_FILE`로 정한다**: 비서가 서버를 띄울 때 넘긴다. 없으면 서버 설치 위치에서 저장소 루트의 `.env.local`을 찾는다.
- **Gmail의 OAuth 클라이언트는 `.env.local`의 `GMAIL_CLIENT_ID`·`GMAIL_CLIENT_SECRET`만 쓴다**(`client.json` 파일을 더는 읽지 않는다).
- **옮기기 명령**을 비서에 둔다(`my-task-agent migrate-tokens`): 지금 있는 토큰 파일들을 읽어 `.env.local`에 쓰고, 다시 읽어 확인한 뒤 원래 파일을 지운다. 맥북과 집 서버에서 각각 한 번 실행한다.
- 비서가 서버에 넘기던 토큰 폴더 변수(`MS_TODO_TOKEN_CACHE`, `GMAIL_MCP_DIR`, `KAKAO_MCP_DIR`)는 없앤다.
- **범위 밖**: 비서의 기억 파일(`memory.json`, 토큰이 아니라 처리 기록)은 지금 위치에 그대로 둔다. 비밀값 암호화나 별도 비밀 관리 도구, GitHub·폴리오 키(이미 `.env.local`에 있고 바뀌지 않음), 토큰을 여러 컴퓨터가 함께 쓰는 동기화.

## Capabilities

### New Capabilities
- `token-env-file`: MCP 서버들이 저장소 루트의 `.env.local`에 토큰을 읽고 고쳐 쓰는 공통 규칙(자기 키만, 다른 줄 보존, 잠금과 원자적 교체, 권한 600, 위치 설정, 옮기기).

### Modified Capabilities
- `microsoft-todo-tools`: 로그인 토큰을 홈 폴더의 파일이 아니라 루트 `.env.local`의 `MS_TODO_TOKEN_CACHE_DATA`에 저장한다.
- `gmail-tools`: 로그인 토큰을 루트 `.env.local`의 `GMAIL_REFRESH_TOKEN`에 저장하고, 권한 확인 대상이 토큰 폴더에서 `.env.local`로 바뀐다.
- `kakao-send-tools`: 새 리프레시 토큰을 로컬 파일이 아니라 루트 `.env.local`의 `KAKAO_REFRESH_TOKEN` 줄에 저장한다.
- `veloo-tools`: 세션을 루트 `.env.local`의 `VELOO_SESSION`에 저장해서 재사용한다.

## Impact

- 코드: `mcp/microsoft-todo/`, `mcp/gmail/`, `mcp/kakao/`, `mcp/veloo/`의 토큰 저장 부분과 테스트, `agent/`의 설정과 새 명령. 공통 모듈은 서버마다 같은 파일을 두고 내용이 같은지 테스트로 지킨다(서버들이 독립 패키지라서).
- 운영: 맥북과 집 서버의 `~/.config/` 아래 토큰 폴더가 없어지고 `.env.local` 하나가 남는다. 집 서버는 코드를 다시 복사·빌드하고 옮기기 명령을 한 번 실행해야 한다. 내일 아침 7시 실행 전에 하지 못하면 그 실행은 지금 방식 그대로 돈다.
- 위험: 서버들이 한 파일을 함께 고쳐 쓰므로 잘못 쓰면 다른 비밀까지 잃을 수 있다(잠금, 원자적 교체, 옮기기 전 백업으로 막는다). 지금은 서버마다 자기 환경 변수만 받는데, 같은 파일을 열게 되므로 다른 서버의 비밀을 읽을 수 있는 구조가 된다(코드에서 자기 키만 읽고 쓰게 막고 테스트로 지킨다).
- 이미 보관된 명세 4개의 토큰 저장 요구사항이 바뀐다.
