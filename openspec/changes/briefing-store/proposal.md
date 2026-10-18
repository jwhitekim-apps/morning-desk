# Proposal

## Why

Archi Studio(대학원 연구 도구를 하나로 합친 새 웹앱)에는 비서가 매일 만든 브리핑을 다시 읽는 "로그" 화면이 들어간다. 그런데 지금 비서의 브리핑은 카톡 나에게 보내기로 한 번 나가고, 남는 기록은 어제 기록 파일(`memory.json`)뿐이다. 앱이 읽을 곳이 없다.

앱이 읽으려면 비서가 브리핑을 Archi Studio의 Supabase 데이터베이스(DB)에 기록해야 한다. 그런데 이 저장소의 위임 정책은 쓰기를 "To Do에 태스크 추가"와 "카톡 나에게 보내기" 두 가지로만 허용하고, 허용 목록 시험이 그 밖의 쓰기를 막고 있다. 그래서 브리핑 기록은 정책을 **의도적으로** 고쳐서 넣어야 하는 새 쓰기 권한이다. 새 권한을 최대한 좁게 정하는 것이 이 변경의 핵심이다.

## What Changes

- 새 모듈 `sources/briefing-store`를 만든다. 앱이 받는 함수는 **`saveBriefing` 하나**뿐이다. 이 모듈이 DB에 보내는 요청은 `archi_save_briefing`이라는 DB 함수를 부르는 POST 한 종류뿐이고, 다른 테이블 쓰기, 수정, 삭제는 코드에 없다.
- 하루 실행에 저장 단계를 더한다: 브리핑 본문을 만든 뒤 저장하고, 저장에 성공하면 카톡 말풍선에 Archi Studio의 해당 브리핑 링크를 덧붙인다. 드라이런이면 저장하지 않고 카톡도 보내지 않는다.
- 저장은 설정 `ASSISTANT_SAVE_BRIEFING=1`일 때만 한다(기본 꺼짐). 저장에 실패해도 카톡 전송은 막지 않고, 실패는 오류 코드로 구분해 브리핑의 실패 구역과 로그에 남긴다.
- 같은 날 두 번 저장하면(예: `force` 재실행) 그날 브리핑 한 건을 새 내용으로 덮어쓴다. 여러 건이 생기거나 다른 날짜가 바뀌지 않는다.
- 위임 정책의 문서와 시험을 의도적으로 고친다: `AGENTS.md`의 위임 정책, 모듈의 허용 목록 시험(`sources/briefing-store/test/allowlist.test.ts`), 앱이 받는 함수를 고정하는 `app/test/run.test.ts`.
- 접속 설정 4개를 더한다(키 보관은 기존처럼 `.env.local`): 저장 켜기, DB 주소와 접속 키, 브리핑 주인(Archi Studio 사용자) 번호, 링크용 앱 주소.
- 저장하는 내용의 범위를 정한다: **카톡으로 이미 나가는 것과 같은 범위**(제목까지)만 저장하고, 메일 본문, 보낸 사람, 알림 내용은 저장하지 않는다.

**범위 밖**
- Archi Studio 쪽의 DB 함수와 전용 역할 만들기(그 저장소의 `archi-studio-briefing` change가 맡는다. 이 change는 그 함수의 **호출 계약**만 정한다).
- 브리핑을 읽어 보여주는 API와 화면(Archi Studio의 `archi-studio-briefing`, `archi-studio-ui-briefing`).
- 이미 보낸 지난 브리핑을 소급해서 저장하는 일, 저장된 브리핑의 수정과 삭제.
- 집 서버 크론이나 `.env.local`을 실제로 바꾸는 일(서버 배포는 별도 작업이다).

## Capabilities

### New Capabilities
- `briefing-store-tools`: 비서 앱이 하루 브리핑을 Archi Studio DB에 기록하는 유일한 쓰기 함수 `saveBriefing`의 계약. 무엇을 어디에 쓰는지, 무엇은 쓰지 않는지, 같은 날 다시 저장하면 어떻게 되는지, 키 보호와 오류 구분, 저장 범위를 정한다.

### Modified Capabilities
<!-- 없음. "쓰기는 태스크 추가와 나에게 보내기뿐"이라는 문구는 아직 보관되지 않은 `assistant-app` 변경의 `daily-briefing` 안에 있고 메인 명세에는 없어서 MODIFIED로 고칠 수 없다. 겹치는 부분의 처리는 design.md의 결정 6을 본다. -->

## Impact

- 코드(구현 때): 새 `sources/briefing-store/`(`src/index.ts`, `src/config.ts`, `src/errors.ts`, `src/briefing-store/api.ts`, `test/allowlist.test.ts`, `test/briefing-store.test.ts`, `test/privacy.test.ts`, `README.md`, `package.json`), `app/src/modules.ts`(모듈 연결), `app/src/run.ts`(저장 단계와 링크), `app/src/briefing/report.ts` 또는 `deliver.ts`(링크 한 줄, 저장 실패 안내), `app/src/config.ts`(설정), `app/test/run.test.ts`(허용 목록).
- 설정: `.env.local`에 `ASSISTANT_SAVE_BRIEFING`, `BRIEFING_STORE_SUPABASE_URL`, `BRIEFING_STORE_KEY`, `BRIEFING_STORE_USER_ID`, `ARCHI_STUDIO_BASE_URL`(마지막은 비우면 링크 없이 저장만 한다). 키는 비밀값이므로 저장소에 올리지 않는다.
- 위임 정책: 앱이 받는 쓰기 함수가 둘에서 셋으로 의도적으로 늘어난다(`createTask` 계열, `sendManyToMe`, `saveBriefing`). 새 쓰기는 한 DB 함수 호출 하나로 고정한다.
- 개인정보: 브리핑 내용(제목 수준의 메일·GitHub·논문·할 일 이름)이 Supabase 클라우드에 저장된다. 카톡으로 나가는 범위와 같게 제한한다(design.md 결정 5). 소스 내용은 로컬 LLM에만 보낸다는 기존 원칙은 그대로다. 저장소는 LLM이 아니다.
- 선행: 이 저장소의 코드에는 없음. 다른 저장소 몫으로, Archi Studio의 `archi-studio-briefing`이 `archi_save_briefing` 함수와 전용 역할을 DB에 만들어야 이 change를 켤 수 있다(구현은 먼저 해도 시험은 가짜 서버로 한다). 서버에 올리는 순서는 `sources-as-modules`와 `improve-briefing`의 서버 배포 뒤다.
- 문서: `README.md`, `AGENTS.md`, `sources/briefing-store/README.md`.
