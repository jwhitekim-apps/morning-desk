# Design

## Context

벨루(`/Users/joon/CODINGPROJECT/veloo/veloo.2joon.com`)는 FastAPI 서버 하나에 도구 다섯 개를 올린 앱이다(관찰한 코드 기준).

- **서버:** `server/main.py`가 할 일 앱을 `/todo`에 붙이고(`app.mount("/todo", todo_app)`), 마감 리마인드 스케줄러(`start_scheduler`/`stop_scheduler`)를 함께 시작하고 끈다.
- **할 일 기능 (`server/app/todo/`):**
  - 라우터: `todos`, `steps`, `reviews`, `ai`(작업 분해)
  - 마감 리마인드: `core/scheduler.py`(APScheduler cron)가 `NOTIFY_TO`로 메일을 보낸다. 발송은 `core/email_sender.py`(Gmail SMTP, `SMTP_USER`·`SMTP_APP_PASSWORD`)가 한다.
- **데이터:** `server/schema.sql`의 `todos`(사용자 FK, cascade)와 `steps`(`todos` FK, cascade). 다른 도구의 히스토리 테이블(`paper_history` 등)은 이 둘을 참조하지 않는다.
- **웹:**
  - 화면: `web/src/features/todos/`, `web/src/features/calendar/`(캘린더, 주간 리뷰)
  - 경로: `app/App.tsx`의 `tasks`, `tasks/:taskId`, `calendar`, `calendar/review`. 로그인 후 첫 화면(`index`)이 `tasks`로 이동한다.
  - 내비게이션: `shared/navigation/workspaceNav.ts`의 `tasks`·`calendar` 항목, 모바일의 "Plan" 탭과 마지막 방문 기억(`veloo:last-plan-app`)
  - 다른 도구 화면은 할 일 모듈을 가져다 쓰지 않는다(`features/todos`·`features/calendar`를 가져오는 곳은 `App.tsx`와 `shared/api/client.ts`뿐).
- **운영:** 프라이빗 베타(승인한 다른 사용자가 있을 수 있음), 집 서버의 `veloo-app-1` 컨테이너로 배포한다.
- **저장소 상태:** 지금 커밋하지 않은 사용자 변경이 있다(`TODO.md`, 새 파일 하나).

my-task에서는 `mcp/veloo/`가 Plan API(`/todo/api/todos`, 주간 리뷰)만 읽는다.
- 비서(`agent/`)는 이미 벨루를 출처에서 뺐다.
- `env-file.ts` 동일성 테스트와 `migrate-tokens`가 벨루를 포함하고, Mac의 `.env.local`에 `VELOO_*` 줄이 있다.

## Goals / Non-Goals

**Goals:**
- 벨루에서 할 일·캘린더·주간 리뷰·리마인드 메일을 없애고, 나머지 네 도구는 그대로 동작한다.
- 지운 데이터를 필요하면 되살릴 수 있다(백업).
- my-task에서 벨루를 읽는 코드와 비밀을 남기지 않는다.

**Non-Goals:**
- 벨루의 나머지 도구, 로그인·가입, 배포 방식 변경.
- 옮긴 태스크를 To Do 안에서 다시 정리하는 일.
- 주간 리뷰 기능을 To Do 쪽에 다시 만드는 일.

## Decisions

### 1. 순서는 "백업 → 코드 제거·배포 → 확인 → 데이터 삭제 → my-task 정리"다
코드를 먼저 지우고 배포해서 아무도 새 할 일을 적지 못하게 한 뒤, 데이터를 지운다. 반대로 하면 배포 사이에 Plan 화면이 빈 테이블을 보고 오류를 낸다.

데이터 삭제는 되돌릴 수 없으므로 맨 마지막에 하고, 그 전에 백업 파일을 다시 읽어 건수가 맞는지 확인한다.

my-task의 벨루 MCP는 벨루 API가 사라지면 쓸모가 없으므로 벨루 배포 뒤에 정리한다. 그 전에는 옮기기 결과를 대조하는 데 쓸 수 있다.

### 2. 숨기지 않고 지운다
화면만 숨기고 코드를 남기는 방법도 있다. 하지만 스케줄러가 계속 돌고 API도 열려 있게 된다.

코드는 git 기록과 기존 번들(`veloo-backup-20260906.bundle`)에 남으므로, 지우는 쪽이 단순하다.

### 3. 로그인 후 첫 화면은 Paper Analyzer(`papers`)로 바꾼다
지금은 `index`가 `tasks`로 이동한다. 남는 도구 중 첫 번째인 `papers`로 바꾼다. 다른 화면을 원하면 적용 때 사용자가 고른다.

옛 주소(`/:username/tasks`, `/calendar`)로 들어오면 첫 화면으로 보내서 빈 화면이나 404를 보이지 않는다.

### 4. 데이터는 사용자별 건수를 먼저 보고, 백업한 뒤 지운다
지우기 전에 사용자별 `todos`·`steps` 건수를 센다. 사용자 본인 외의 데이터가 있으면, 그 사용자에게 알릴지와 알리는 방법을 사용자가 정한 뒤에 진행한다.

백업:
- 대상은 두 테이블 전체다(JSON 또는 `pg_dump`).
- 저장소 밖에 둔다: `~/backups/veloo-plan-YYYYMMDD/`, 폴더 700, 파일 600.
- 다시 읽어 행 수를 대조한다.
- 최소 90일 보관한다.

백업 방법(Supabase REST로 읽기, `pg_dump`)은 벨루가 쓰는 연결 정보에 따라 적용 때 정한다. 연결 정보는 채팅에 붙여 넣지 않고 벨루 `.env`에서 읽는다.

### 5. 벨루 저장소는 사용자 변경을 건드리지 않는 별도 브랜치에서 고친다
지금 커밋하지 않은 사용자 변경이 있으므로, 먼저 사용자가 그것을 정리(커밋하거나 보류)하게 한 뒤 브랜치(`remove-plan`)를 만들어 고친다.

벨루는 이 세션 밖이라 첫 편집 전에 경로를 밝혀 확인받는다. 고치는 동안에는 "세션 밖 작업" 표시를 붙인다.

### 6. my-task는 벨루를 완전히 뺀다
- `mcp/veloo/` 삭제, `veloo-tools` 명세 은퇴(이 변경의 delta)
- `env-file.ts` 동일성 테스트 목록에서 `mcp/veloo` 제거
- `migrate-tokens`의 벨루 항목 제거
- `AGENTS.md`의 `VELOO_SESSION`·벨루 출처 문구 정리
- Mac `.env.local`의 `VELOO_BASE_URL`·`VELOO_USERNAME`·`VELOO_PASSWORD`·`VELOO_SESSION` 줄 삭제(백업 뒤)

집 서버에는 벨루 줄이 없다.

### 7. 진행 중인 `env-token-store`를 먼저 보관한다
`env-token-store`의 delta가 `veloo-tools`의 세션 요구사항을 바꾼다. 이 변경이 같은 명세를 은퇴시키므로, `env-token-store`를 먼저 보관(명세 동기화)한 뒤 이 변경을 적용해야 명세가 꼬이지 않는다.

## Risks / Trade-offs

- **다른 베타 사용자가 할 일 기능을 잃는다.** 결정 4의 건수 확인과 알림으로 줄이지만, 기능 자체는 돌아오지 않는다.
- **데이터 삭제는 되돌릴 수 없다.** 백업을 다시 읽어 대조한 뒤에만 지운다. 백업을 잃으면 복구할 방법이 없으므로 보관 위치를 사용자에게 알린다.
- **마감 리마인드 메일이 끊긴다.** 대신 아침 카톡 브리핑이 오늘·밀린 일을 알린다. 브리핑은 메일이 아니라서 성격이 다르다.
- **옮긴 완료 태스크의 완료 날짜는 옮긴 날(2026-10-11)로 기록되었다.** 원래 완료 날짜는 벨루 백업에만 남는다.
- **주간 리뷰가 없어진다.** To Do에는 같은 기능이 없다. 필요해지면 비서 쪽 별도 변경으로 다룬다.
