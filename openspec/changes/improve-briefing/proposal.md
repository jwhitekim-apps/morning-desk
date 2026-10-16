# Proposal

## Why

매일 오는 브리핑이 To Do 중심이라, 앱이 읽는 나머지 소스(메일, GitHub, 폴리오)와 집 서버 상태는 **읽었는지조차 알 수 없다**. 확인한 사실: (1) 서버 설정의 `ASSISTANT_SOURCES`가 `gmail,github`라서 폴리오는 한 번도 읽히지 않고, 서버 `.env.local`에 폴리오 키도 없다. (2) 메일·GitHub는 모델이 할 일 후보를 낸 날에만 "새로 찾은 일"로 흔적이 남고, 최근 5일은 후보가 1·0·0·1·1건이었다. (3) 서버 점검 모듈(`sources/server`)은 만들어 두었지만 하루 실행에 연결되지 않았다. (4) [참고] 구역의 두 문장이 사용자에게 도움이 되지 않는다: "비교 모드라 To Do에 추가하지 않았어요."는 이전 시스템이 사라진 지금 틀린 표현이고, "근거가 부족한 후보 N건, 날짜 M건은 빼거나 비웠어요."는 서로 다른 사유(근거 인용 없음, 지시문 같은 제목, 중복, 상한 초과)를 합친 숫자라 무슨 일이 있었는지 알 수 없다. (5) 카톡은 한 통 200자·최대 3통이라 더 보여 주려면 분량 문제를 풀어야 한다. 실행 시각도 낮 12시로 옮기기로 했다.

## What Changes

- 브리핑에 **소스별 구역**을 더한다: 메일, GitHub, 폴리오가 각각 몇 건이었는지와 항목 제목(상한 있음)을 후보 유무와 관계없이 보여 준다. 읽지 않은 소스는 "꺼짐"으로, 실패한 소스는 실패 구역에 나온다.
- 서버 점검(`sources/server`의 `checkServices`, `checkLlm`)을 **하루 실행에 연결**한다. 이상(저하, 중단, 점검 불가)만 항목으로 보여 주고 모두 정상이면 한 줄로 알린다. 도커 로그 요약은 이번에 연결하지 않는다.
- **[참고] 구역을 정리**한다: 태스크 추가가 꺼져 있다는 안내는 현재 상태에 맞는 문장으로 바꾸고, 모델 출력을 걸러낸 건수는 카톡에서 빼서 로그에 **사유별 건수**로만 남긴다.
- **실행 시각을 낮 12시(KST)**로 바꾼다. 제목의 "아침 보고"와 모델 지시문의 "아침 브리핑"도 시각에 맞는 표현으로 고친다. 실제 변경은 집 서버 크론이다.
- 카톡 분량 문제는 **선택지와 사실을 정리하고 열린 질문으로 남긴다**(design.md). 추천안은 분량을 먼저 측정한 뒤 통수를 늘리는 것이다. 결정되면 이 변경의 작업과 명세를 이어서 고친다.
- 소스 내용이 카톡(외부 서비스)으로 나가는 범위를 정한다: 제목까지, 보낸 사람·본문·알림 내용은 보내지 않는다.
- **범위 밖**: 도커 로그 요약의 브리핑 연결, 모델 주도 도구 호출, 태스크 자동 추가를 켜는 일(`assistant-app` 7.2), 다른 메신저로 옮기는 일.

## Capabilities

### New Capabilities
- `briefing-source-report`: 브리핑이 소스별(메일, GitHub, 폴리오)과 서버 상태를 어떻게 보고하는지, 소스 내용이 카톡으로 나가는 범위, [참고] 구역의 규칙, 기본 실행 시각을 정한다.

### Modified Capabilities
<!-- 없음. 브리핑의 기본 규칙(`daily-briefing`)은 아직 보관되지 않은 `assistant-app` 변경 안에만 있고 메인 명세에 없어서 이 변경에서 MODIFIED로 고칠 수 없다. 겹치는 부분의 처리는 design.md의 결정 1을 본다. `server-tools`는 내보내는 함수가 그대로라서 바꾸지 않는다(결정 6). -->

## Impact

- 코드: `app/src/briefing/report.ts`(소스·서버 구역, 제목), `app/src/run.ts`(구역 입력, 참고 문장), `app/src/model/interpret.ts`(걸러낸 사유별 집계), `app/src/model/prompt.ts`(지시문의 "아침"), `app/src/modules.ts`(서버 점검 모듈을 앱이 받는 소스에 추가), `app/test/*`. 카톡 통수를 바꾸기로 하면 `app/src/briefing/deterministic.ts`의 `MAX_BUBBLES`와 `sources/kakao/src/kakao/api.ts`의 `MAX_BATCH`, 그 테스트.
- 설정: 집 서버 `.env.local`에 `ASSISTANT_SOURCES`(`folio` 추가), 폴리오 키 2줄(`FOLIO_SUPABASE_URL`, `FOLIO_SUPABASE_KEY`), `SERVER_TARGETS` 또는 `sources/server/targets.json`(저장소에 올리지 않는 파일). 집 서버 크론을 12시로.
- 위임 정책: 앱이 받는 함수 목록에 서버 점검 모듈의 네 함수(`listTargets`, `checkServices`, `checkLlm`, `summarizeDockerLogs`)가 의도적으로 늘어난다(`app/test/run.test.ts`의 허용 목록 포함). 모두 읽기 전용이고 하루 실행이 실제로 부르는 것은 `checkServices`와 `checkLlm` 둘뿐이다. 이 둘은 모델을 올리지 않는다.
- 개인정보: 메일 제목, GitHub 제목, 논문 제목이 카톡으로 나간다(지금은 To Do 태스크 이름이 나간다). 위험과 범위는 design.md의 결정 5.
- 선행 조건: `sources-as-modules`의 집 서버 배포(7번 묶음)가 먼저다. 이 변경은 새 구조(`app/`, `sources/`)를 기준으로 쓰였고, 서버는 지금도 이전 구조(`agent/dist`)로 돌고 있다.
- 문서: `README.md`, `AGENTS.md`, `assistant-app`의 "아침/7시" 표현과 결정 기록.
