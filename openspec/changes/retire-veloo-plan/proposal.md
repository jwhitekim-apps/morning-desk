# Proposal

## Why

할 일은 이제 Microsoft To Do 한 곳에서만 관리한다. 2026-10-11에 벨루의 태스크 80개를 To Do의 "작업" 목록으로 옮겼다(열린 6개, 완료 74개. 마감을 자유 글로 적은 16개는 기한 없이 만들고 원래 글을 노트에 남김). 벨루의 할 일 기능(Plan: 할 일 + 캘린더 + 주간 리뷰 + 마감 리마인드 메일)이 남아 있으면 할 일을 두 곳에 적게 되고, my-task의 벨루 MCP도 더는 읽을 이유가 없다. 벨루의 나머지 네 도구(Paper Analyzer, Translator, Contextor, Model Review)는 계속 쓰므로 벨루 전체가 아니라 **Plan만** 없앤다.

## What Changes

벨루 저장소(`/Users/joon/CODINGPROJECT/veloo/veloo.2joon.com`, 이 저장소 밖)에서 할 일 (실제 편집은 적용 단계에서 사용자 확인 후):
- **BREAKING** 서버: `server/app/todo/`(할 일·단계·리뷰·AI 분해 라우터, 마감 리마인드 스케줄러, SMTP 메일 발송)를 지우고, `server/main.py`의 `/todo` 마운트와 스케줄러 시작·종료를 뺀다.
- **BREAKING** 웹: `web/src/features/todos/`, `web/src/features/calendar/`, `tasks`·`calendar` 경로, 내비게이션의 할 일·캘린더 항목(모바일의 "Plan" 탭 포함)을 지운다. 로그인 후 첫 화면(지금은 `tasks`로 이동)을 다른 도구로 바꾼다.
- **BREAKING** 데이터: `todos`·`steps` 테이블을 **백업한 뒤** 지운다. 프라이빗 베타라 다른 승인 사용자의 데이터가 있을 수 있으므로, 지우기 전에 사용자별 건수를 확인하고 있으면 사용자에게 알린다. `schema.sql`에서도 뺀다.
- 설정: `.env`의 `NOTIFY_TO`, `SMTP_USER`, `SMTP_APP_PASSWORD`(리마인드 메일 전용)를 정리한다.
- 순서: 2~4주 동안 To Do로 잘 쓰는지 본 뒤가 아니라, 사용자가 지금 삭제 계획을 세우기로 했다. 다만 데이터 삭제는 백업과 확인 뒤 마지막에 한다.

my-task(이 저장소)에서 할 일:
- **BREAKING** 벨루 MCP 서버(`mcp/veloo/`)를 은퇴시킨다: 코드 삭제, `veloo-tools` 명세 은퇴, `.env.local`의 `VELOO_*` 줄(계정, 세션) 정리.
- 공통 모듈 `env-file.ts`의 동일성 테스트와 `migrate-tokens`, 문서(`AGENTS.md`, README)에서 벨루를 뺀다.

**범위 밖**: 벨루의 나머지 네 도구와 로그인·가입, 벨루 서버의 배포 방식 자체. 옮긴 태스크의 정리(To Do 안에서 사용자가 함).

## Capabilities

### New Capabilities
<!-- 없음 -->

### Modified Capabilities
- `veloo-tools`: 벨루 Plan이 없어지므로 이 능력 전체를 은퇴시킨다(모든 요구사항 제거).

## Impact

- 벨루 저장소: 서버의 `server/app/todo/`와 `server/main.py`, 웹의 `features/todos`·`features/calendar`·`app/App.tsx`·`shared/navigation/workspaceNav.ts`·모바일 내비게이션·다국어 문구, `server/schema.sql`, `.env.example`. 집 서버의 `veloo-app-1` 컨테이너를 다시 빌드·배포해야 한다.
- 벨루 데이터베이스: `todos`, `steps` 테이블(되돌릴 수 없음, 백업 필수).
- my-task: `mcp/veloo/` 삭제, `mcp/microsoft-todo/test/env-file-same.test.ts`, `agent/src/migrate.ts`, `AGENTS.md`, `openspec/specs/veloo-tools/`.
- 진행 중인 변경과의 관계: `env-token-store`(아직 보관 전)가 벨루의 `VELOO_SESSION` 저장을 다룬다. 이 변경을 적용하기 전에 `env-token-store`를 먼저 보관해서 명세 충돌을 피한다.
- 저장소 규칙: 벨루는 별도 프로젝트이므로 그쪽 파일을 고치기 전에 경로를 밝혀 사용자 확인을 받는다. 벨루 저장소에는 지금 커밋하지 않은 사용자 변경(`TODO.md` 등)이 있어서 건드리지 않는다.
