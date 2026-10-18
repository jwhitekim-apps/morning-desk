# Tasks

모든 명령은 저장소 루트(`morning-desk`)에서 실행한다. 시험은 가짜 서버(`fetchFn`)로만 하고 네트워크는 쓰지 않는다. 1.2와 4.3만 Archi Studio 저장소(`/home/joon/workspace/archi-studio`)의 로컬 Supabase를 쓴다.

## 1. 확인

- [ ] 1.1 `grep -rn -i -E "태스크 추가|나에게 보내기|쓰기는|only writes|write" AGENTS.md README.md openspec/changes/assistant-app openspec/changes/improve-briefing`으로 "쓰기는 두 가지뿐"이라는 뜻의 문구 위치를 모두 찾아 이 change의 `design.md` 결정 6에 `파일:줄` 목록으로 적는다. 검증: 목록이 `design.md`에 있고 `AGENTS.md`의 위임 정책 줄이 포함되어 있다
- [ ] 1.2 Archi Studio 저장소에서 `npm run db:start` 후 임시 SQL(저장소에 올리지 않음)로 전용 역할 하나와 시험용 `archi_save_briefing`을 로컬 DB에만 만들고, 그 역할로 서명한 키로 `POST /rest/v1/rpc/archi_save_briefing`가 200이고 `GET /rest/v1/archi_briefings`와 다른 테이블 접근은 401 또는 403인지 `curl`로 확인한다(`npm run db:stop`으로 끝낸다). 검증: 결과(되면 "전용 키 방식 가능", 안 되면 "서비스 키로 시작")를 `design.md` 결정 4에 한 줄 적었고 키 값은 어디에도 적지 않았다

## 2. 브리핑 저장 모듈

- [ ] 2.1 `sources/briefing-store/`(`package.json`, `tsconfig.json`, `src/index.ts`, `src/config.ts`, `src/errors.ts`)를 폴리오 모듈과 같은 모양으로 만들고 `saveBriefing`만 내보내는 `BRIEFING_STORE_ALLOWED = ["saveBriefing"]`을 정한다. 검증: `npm run typecheck`가 통과하고 `npm test -w sources/briefing-store`의 허용 목록 시험이 내보내는 이름이 정확히 `["saveBriefing"]`이고 `delete|remove|update|edit|patch|clear` 이름이 없음을 확인한다
- [ ] 2.2 `src/briefing-store/api.ts`에 `archi_save_briefing` 호출(POST, `apikey`와 `Authorization` 헤더, 본문 `p_user_id`, `p_date`, `p_summary`, `p_body`, `p_item_keys`, 응답 `{id, linked, skipped}` 해석)을 만든다. 검증: 가짜 `fetchFn` 시험에서 나간 요청이 정확히 1개이고 메서드 POST, 경로 `/rest/v1/rpc/archi_save_briefing`, 본문 키가 정확히 5개다
- [ ] 2.3 입력 검증(요약 1~200자, 본문 1~20,000자, `itemKeys` 0~50개, 실제 있는 `YYYY-MM-DD`)을 요청 전에 한다. 검증: 요약 0자·201자, 본문 20,001자, 항목 번호 51개, `2026-02-30` 각각에서 요청이 0건이고 `validation_error`이며, 경계값(요약 200자, 본문 20,000자, 항목 번호 50개, `2026-02-28`)은 요청이 1건 나간다
- [ ] 2.4 오류 구분과 재시도를 만든다: 키 오류 `auth_error`, 함수 없음 `function_missing`, 주인 번호 오류(외래 키 위반) `user_unknown`, 서버 일시 장애(5xx, 429, 연결 오류) `server_unavailable`. 서버 일시 장애만 최대 2번 다시 시도한다. 검증: 가짜 서버가 503, 503, 200을 순서대로 돌려주면 요청 3번에 성공 1건이고, 401, 404(함수 없음), 외래 키 위반, 400은 요청 1번에 각 오류 코드로 끝난다
- [ ] 2.5 설정 검사와 키 보호를 만든다: 주소는 `https://`만 허용(`localhost`와 `127.0.0.1`은 예외), 키가 응답, 오류 메시지, 로그에 나오지 않는다. 검증: `http://example.com` 설정은 요청 전에 설정 오류이고, 모든 오류 경로에서 로그 출력과 던져진 오류 메시지를 모아 키 문자열을 검색하면 0건이다(`test/privacy.test.ts`)
- [ ] 2.6 `test/allowlist.test.ts`가 소스를 읽어 HTTP 호출 지점이 한 파일(`briefing-store/api.ts`)의 한 곳이고 메서드가 `POST` 하나이며 `PUT`, `PATCH`, `DELETE`, `/rest/v1/archi_`(테이블 직접 접근) 문자열이 없음을 고정하게 한다. 검증: 시험이 통과하고, 소스에 일부러 `method: "DELETE"` 한 줄을 넣으면 시험이 실패하는 것을 한 번 확인한 뒤 되돌려 `git diff`에 그 줄이 없다

## 3. 하루 실행 연결

- [ ] 3.1 `app/src/modules.ts`와 `app/src/config.ts`에 모듈 연결과 설정 5개(`ASSISTANT_SAVE_BRIEFING`, `BRIEFING_STORE_SUPABASE_URL`, `BRIEFING_STORE_KEY`, `BRIEFING_STORE_USER_ID`, `ARCHI_STUDIO_BASE_URL`)를 더하고, 앱이 받는 함수를 고정하는 `app/test/run.test.ts`에 `briefingStore: ["saveBriefing"]`을 **의도적으로** 추가한다. 검증: `npm test`가 통과하고 시험이 요구하는 모듈별 함수 목록에서 `briefingStore`만 새로 생겼으며 다른 모듈의 목록은 그대로다
- [ ] 3.2 숫자만으로 한 줄 요약을 만드는 함수를 만든다(예: "10월 18일 브리핑: 오늘 할 일 3건, 새로 찾은 일 2건, 점검 이상 1건", 1~200자, 제목 미포함, 모델 사용 없음). 검증: 시험에서 건수가 0이어도 비지 않고, 항목 이름이 들어 있는 가짜 데이터로 만들었을 때 요약에 그 이름이 없다
- [ ] 3.3 `app/src/run.ts`에 저장 단계를 더한다(본문 만들기, 저장, 성공하면 링크 덧붙이기, 카톡 전송, 기억 저장 순서). 검증: `app/test/run.test.ts`에 시나리오 표를 더해 통과한다: 드라이런이면 저장 요청 0건, 설정이 꺼져 있으면 0건, 이미 보낸 날이면 0건, `force` 재실행이면 같은 날짜로 1건, 저장 성공이면 말풍선 끝에 `<앱 주소>/log/<브리핑 번호>`가 붙고, 저장 실패(503 반복)면 링크 없이 카톡이 그대로 나가고 실패 구역에 오류 코드가 한 줄 나오며, 앱 주소가 비어 있으면 링크가 없다
- [ ] 3.4 개인정보 시험을 더한다. 검증: 메일 본문, 보낸 사람, 알림 내용에 표시 문자열을 심은 가짜 소스로 하루 실행을 해서 저장 요청 본문(`body`, `summary`)에 그 문자열이 0건이고 카톡 말풍선과 저장 본문이 같은 제목 범위이며, 앱이 남긴 로그에는 제목과 본문이 없다

## 4. 정책 문서와 마무리

- [ ] 4.1 `AGENTS.md`(구조도에 모듈 줄, 위임 정책에 새 쓰기 한 가지와 허용 목록 시험, 설정 목록), `README.md`, 새 `sources/briefing-store/README.md`(키 방침: 개발·시험은 서비스 키 허용, 운영 전 전용 역할 키로 교체)를 고치고, 1.1에서 찾은 `assistant-app` 문서의 쓰기 문구를 이 change를 가리키게 고친다. 검증: 1.1의 `grep`을 다시 돌렸을 때 "쓰기는 두 가지뿐"이라는 옛 문구가 0건이거나 새 쓰기를 포함한 문구로 바뀌어 있다
- [ ] 4.2 `npm run typecheck && npm run lint && npm test && npm run build`가 모두 통과하고, 빌드 산출물 `app/dist/index.js`에서 `grep -c "/rest/v1/rpc/archi_save_briefing"`가 1 이상, `grep -c "/rest/v1/archi_"`가 0이며, `openspec validate briefing-store --strict`가 통과한다
- [ ] 4.3 (주인과 함께 하는 실물 확인, 코드 변경 없음) Archi Studio 저장소의 로컬 Supabase에 `archi-studio-briefing`이 만든 함수가 있는 상태에서 설정을 로컬 주소로 두고 `app`을 드라이런과 실제 저장으로 한 번씩 실행한다. 검증: 실제 저장을 같은 날 두 번 실행한 뒤 SQL `select count(*) from archi_briefings where date = '<오늘>'`이 1이고, 두 번째 내용으로 바뀌어 있으며, 카톡을 쓰지 않는 설정(`dry-run`)에서는 행이 늘지 않는다
