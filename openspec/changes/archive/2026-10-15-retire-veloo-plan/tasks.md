# Tasks

## 1. 선행 조건

- [x] 1.1 벨루 태스크를 Microsoft To Do로 옮긴다. 검증: 2026-10-11에 "작업" 목록으로 80개를 옮겼다(열린 6개는 열린 상태, 완료 74개는 완료 상태, 자유 글 마감 16개는 기한 없이 노트에 원문). To Do에서 80개가 모두 확인되고 상태가 벨루와 같다
- [x] 1.2 `env-token-store`를 보관한다(명세 동기화). 검증: `openspec/specs/veloo-tools/spec.md`에 `VELOO_SESSION` 요구사항이 반영되어 있고, 진행 중 변경 목록에 `env-token-store`가 없다 (2026-10-15: `2026-10-15-env-token-store`로 보관, `veloo-tools`에 `VELOO_SESSION` 반영 확인)
- [x] 1.3 벨루 저장소의 커밋하지 않은 사용자 변경을 사용자가 정리하고, `remove-plan` 브랜치를 만든다(벨루는 세션 밖: 첫 편집 전에 경로를 밝혀 확인). 검증: 브랜치에서 `git status`가 깨끗하다. (결정: 사용자가 `TODO.md`·`TODO-완료.md`를 그대로 두고 진행하기로 함. 두 파일은 커밋에 넣지 않는다)

## 2. 백업과 확인 (데이터는 아직 지우지 않음)

- [x] 2.1 벨루 데이터베이스의 사용자별 `todos`·`steps` 건수를 센다(제목은 출력하지 않음). 검증: 건수가 기록되어 있고, 본인 외 사용자의 데이터가 있으면 알릴지와 알리는 방법을 사용자가 정했다. (2026-10-11: 사용자 1명(본인)뿐, todos 80·steps 249. steps(작업 분해 단계)는 To Do로 옮기지 않았고 백업에만 있음)
- [x] 2.2 `todos`·`steps` 전체를 `~/backups/veloo-plan-YYYYMMDD/`(폴더 700, 파일 600)에 백업한다. 연결 정보는 벨루 `.env`에서 읽고 채팅에 붙여 넣지 않는다. 검증: 백업을 다시 읽은 행 수가 2.1의 건수와 같고, 위치를 사용자에게 알렸다. (2026-10-11: `~/backups/veloo-plan-20261011/`의 todos.json 80행, steps.json 249행, 다시 읽어 일치)

## 3. 벨루 코드에서 Plan 제거

- [x] 3.1 서버: `server/app/todo/` 삭제, `server/main.py`의 `/todo` 마운트와 스케줄러 시작·종료 제거, `server/schema.sql`에서 `todos`·`steps` 제거, `.env.example`의 `NOTIFY_TO`·`SMTP_*` 제거. 검증: 서버가 시작되고 `/todo/api/todos`가 404이며, 나머지 네 도구의 API가 응답한다. (2026-10-11 로컬 확인: `/todo/api/*`는 JSON API가 없고, 로그인 전 307·로그인 후 SPA 페이지(HTML 200)를 돌려준다. 서버의 SPA 경로가 모든 미지정 경로를 받아서 404가 아니다. 네 도구 API는 로그인 후 JSON 200. `apscheduler`·`python-dateutil` 제거, `users.email` 열은 유지)
- [x] 3.2 웹: `features/todos`·`features/calendar` 삭제, `App.tsx`의 `tasks`·`calendar` 경로 제거, 첫 화면을 `papers`로 변경, 옛 주소는 첫 화면으로 이동, 내비게이션(데스크톱·모바일 "Plan" 탭, `veloo:last-plan-app`)과 다국어 문구 정리. 검증: `npm run build`와 타입 검사가 통과하고, 소스에 `features/todos`·`features/calendar`·`/todo/` 참조가 없으며, 로그인 후 Paper Analyzer가 열린다. (2026-10-11: 타입 검사·빌드 통과, 첫 화면 `HOME_NAV = papers`, 옛 `tasks/*`·`calendar/*`는 첫 화면으로 이동. 쓰지 않게 된 `@dnd-kit/*`·`dayjs` 제거. 랜딩 페이지는 기능 카드만 뺐고, 미리보기 그림과 "Plan" 문구는 그대로 둠(사용자 결정 필요). 브라우저 확인은 배포(4.1) 때)
- [x] 3.3 벨루 문서(README, docs/features)에서 Plan 설명을 정리하고 브랜치에 커밋한다(푸시는 사용자 확인 후). 검증: README의 기능 목록이 네 도구다. (2026-10-11: `remove-plan` 브랜치에 커밋 `7ae372b`(파일 삭제), `327ee20`(참조 정리). `.env.example`의 리마인드 주석 삭제는 커밋 스크립트가 `.env*` 이름이라 거부해서 커밋하지 않은 채 남김)

## 4. 배포와 확인

- [ ] 4.1 집 서버의 벨루 컨테이너를 새 코드로 다시 빌드·배포한다(이전 이미지 태그를 남겨 되돌릴 수 있게). 검증: 컨테이너가 실행 중이고, 네 도구가 브라우저에서 동작하며, `/todo/api/todos`가 404이고, 리마인드 스케줄러가 시작되지 않는다(로그 확인). (2026-10-11: GitHub Actions 배포는 옛 Windows/WSL 서버를 가리키고 있어 SSH 단계에서 실패, 운영은 바뀌지 않음. 사용자 승인 뒤 집 서버 `~/workspace/veloo`에서 `git pull --ff-only`와 `docker compose up -d --build`로 직접 배포. 되돌림 태그 `veloo:before-remove-plan`. 운영 주소에서 `/todo/api/*`는 JSON 없음(앱 화면), 네 도구 API는 JSON 200, 컨테이너 로그에 오류·스케줄러 없음. 브라우저 화면 확인은 사용자) (2026-10-15 보관 시점: 배포와 API 확인은 끝남. 브라우저 화면 확인만 남아 사용자 몫으로 미룸)
- [x] 4.2 벨루 `.env`(로컬, 집 서버)에서 `NOTIFY_TO`·`SMTP_USER`·`SMTP_APP_PASSWORD`를 지운다(백업 뒤). 검증: 두 곳에 그 키가 없고 컨테이너가 정상이다. (2026-10-11: 로컬·집 서버 `.env` 모두 원래 그 키가 없었음)

## 5. 데이터 삭제 (되돌릴 수 없음)

- [ ] 5.1 사용자 확인을 받은 뒤 `steps`, `todos` 순서로 테이블을 지운다. 검증: 지우기 직전에 백업 행 수를 다시 대조했고, 테이블이 없으며, 네 도구가 계속 동작한다 (2026-10-15 보관 시점: 하지 않고 미룸. 테이블은 코드에서 쓰지 않아 동작에 영향 없음. `steps`는 `~/backups/veloo-plan-20261011`에만 있으므로 테이블 삭제 여부를 정하기 전까지 백업을 지우지 않는다)

## 6. my-task 정리

- [x] 6.1 `mcp/veloo/`를 지우고, `mcp/microsoft-todo/test/env-file-same.test.ts`의 목록에서 `mcp/veloo`를 빼고, `agent/src/migrate.ts`와 그 테스트에서 벨루 항목을 뺀다. 검증: 남은 패키지의 타입 검사, 린트, 테스트, 빌드가 통과하고 저장소에 `mcp/veloo` 참조가 없다
- [x] 6.2 `AGENTS.md`의 벨루 출처와 `VELOO_SESSION` 문구를 정리하고, Mac `.env.local`의 `VELOO_*` 줄을 백업 뒤 지운다. 검증: `.env.local`에 `VELOO_`로 시작하는 줄이 없고 권한이 600이며, `AGENTS.md`에 벨루가 읽기 출처로 나오지 않는다
