# Tasks

## 1. 선행 조건

- [x] 1.1 벨루 태스크를 Microsoft To Do로 옮긴다. 검증: 2026-10-11에 "작업" 목록으로 80개를 옮겼다(열린 6개는 열린 상태, 완료 74개는 완료 상태, 자유 글 마감 16개는 기한 없이 노트에 원문). To Do에서 80개가 모두 확인되고 상태가 벨루와 같다
- [ ] 1.2 `env-token-store`를 보관한다(명세 동기화). 검증: `openspec/specs/veloo-tools/spec.md`에 `VELOO_SESSION` 요구사항이 반영되어 있고, 진행 중 변경 목록에 `env-token-store`가 없다
- [ ] 1.3 벨루 저장소의 커밋하지 않은 사용자 변경을 사용자가 정리하고, `remove-plan` 브랜치를 만든다(벨루는 세션 밖: 첫 편집 전에 경로를 밝혀 확인). 검증: 브랜치에서 `git status`가 깨끗하다

## 2. 백업과 확인 (데이터는 아직 지우지 않음)

- [ ] 2.1 벨루 데이터베이스의 사용자별 `todos`·`steps` 건수를 센다(제목은 출력하지 않음). 검증: 건수가 기록되어 있고, 본인 외 사용자의 데이터가 있으면 알릴지와 알리는 방법을 사용자가 정했다
- [ ] 2.2 `todos`·`steps` 전체를 `~/backups/veloo-plan-YYYYMMDD/`(폴더 700, 파일 600)에 백업한다. 연결 정보는 벨루 `.env`에서 읽고 채팅에 붙여 넣지 않는다. 검증: 백업을 다시 읽은 행 수가 2.1의 건수와 같고, 위치를 사용자에게 알렸다

## 3. 벨루 코드에서 Plan 제거

- [ ] 3.1 서버: `server/app/todo/` 삭제, `server/main.py`의 `/todo` 마운트와 스케줄러 시작·종료 제거, `server/schema.sql`에서 `todos`·`steps` 제거, `.env.example`의 `NOTIFY_TO`·`SMTP_*` 제거. 검증: 서버가 시작되고 `/todo/api/todos`가 404이며, 나머지 네 도구의 API가 응답한다
- [ ] 3.2 웹: `features/todos`·`features/calendar` 삭제, `App.tsx`의 `tasks`·`calendar` 경로 제거, 첫 화면을 `papers`로 변경, 옛 주소는 첫 화면으로 이동, 내비게이션(데스크톱·모바일 "Plan" 탭, `veloo:last-plan-app`)과 다국어 문구 정리. 검증: `npm run build`와 타입 검사가 통과하고, 소스에 `features/todos`·`features/calendar`·`/todo/` 참조가 없으며, 로그인 후 Paper Analyzer가 열린다
- [ ] 3.3 벨루 문서(README, docs/features)에서 Plan 설명을 정리하고 브랜치에 커밋한다(푸시는 사용자 확인 후). 검증: README의 기능 목록이 네 도구다

## 4. 배포와 확인

- [ ] 4.1 집 서버의 벨루 컨테이너를 새 코드로 다시 빌드·배포한다(이전 이미지 태그를 남겨 되돌릴 수 있게). 검증: 컨테이너가 실행 중이고, 네 도구가 브라우저에서 동작하며, `/todo/api/todos`가 404이고, 리마인드 스케줄러가 시작되지 않는다(로그 확인)
- [ ] 4.2 벨루 `.env`(로컬, 집 서버)에서 `NOTIFY_TO`·`SMTP_USER`·`SMTP_APP_PASSWORD`를 지운다(백업 뒤). 검증: 두 곳에 그 키가 없고 컨테이너가 정상이다

## 5. 데이터 삭제 (되돌릴 수 없음)

- [ ] 5.1 사용자 확인을 받은 뒤 `steps`, `todos` 순서로 테이블을 지운다. 검증: 지우기 직전에 백업 행 수를 다시 대조했고, 테이블이 없으며, 네 도구가 계속 동작한다

## 6. my-task 정리

- [ ] 6.1 `mcp/veloo/`를 지우고, `mcp/microsoft-todo/test/env-file-same.test.ts`의 목록에서 `mcp/veloo`를 빼고, `agent/src/migrate.ts`와 그 테스트에서 벨루 항목을 뺀다. 검증: 남은 패키지의 타입 검사, 린트, 테스트, 빌드가 통과하고 저장소에 `mcp/veloo` 참조가 없다
- [ ] 6.2 `AGENTS.md`의 벨루 출처와 `VELOO_SESSION` 문구를 정리하고, Mac `.env.local`의 `VELOO_*` 줄을 백업 뒤 지운다. 검증: `.env.local`에 `VELOO_`로 시작하는 줄이 없고 권한이 600이며, `AGENTS.md`에 벨루가 읽기 출처로 나오지 않는다
