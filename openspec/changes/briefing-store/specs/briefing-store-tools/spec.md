# Spec Delta

## Purpose

비서 앱이 하루 브리핑을 Archi Studio의 데이터베이스(DB)에 기록하는 단 하나의 쓰기 함수 `saveBriefing`의 계약을 정한다. 쓰기 권한을 한 DB 함수 호출 하나로 좁게 고정해, Archi Studio 앱이 브리핑을 읽어 보여 줄 수 있게 하면서 비서의 위임 정책(읽기는 자유, 쓰기는 정해진 것만)을 지키는 것이 목적이다.

## ADDED Requirements

### Requirement: 앱에 주는 쓰기 함수는 saveBriefing 하나다
시스템은 브리핑 저장 모듈에서 `saveBriefing` 하나만 앱에 내보내야 한다(SHALL). 수정, 삭제, 다른 테이블에 쓰는 함수는 코드에 없어야 한다(SHALL NOT). 내보내는 함수 목록은 허용 목록과 정확히 같아야 하고, 목록을 바꾸려면 이 명세와 시험을 함께 고쳐야 한다(SHALL).

#### Scenario: 허용된 함수만 있음
- **WHEN** 브리핑 저장 모듈이 내보내는 함수 이름을 조회한다
- **THEN** `saveBriefing` 하나만 나오고 허용 목록과 정확히 일치한다

#### Scenario: 앱이 받는 함수 목록
- **WHEN** 하루 실행이 받는 모듈 객체의 함수를 모두 조회한다
- **THEN** 브리핑 저장 모듈에서는 `saveBriefing`만 받고, 다른 모듈의 허용 목록은 그대로다

#### Scenario: 쓰기처럼 보이는 다른 함수 이름
- **WHEN** 모듈이 내보내는 이름에 `delete`, `remove`, `update`, `edit`, `patch`, `clear`가 들어간 것이 있는지 검사한다
- **THEN** 하나도 없다

### Requirement: DB에는 한 가지 요청만 보낸다
시스템은 DB에 `archi_save_briefing` 함수를 호출하는 POST 요청 하나(`/rest/v1/rpc/archi_save_briefing`)만 보내야 한다(SHALL). PUT, PATCH, DELETE 요청과 다른 경로의 요청, 테이블을 직접 쓰는 요청을 보내는 코드가 없어야 한다(SHALL NOT).

#### Scenario: 나가는 요청이 한 종류
- **WHEN** 모듈의 모든 코드 경로를 한 번씩 실행하고 나간 요청을 확인한다
- **THEN** 모두 `/rest/v1/rpc/archi_save_briefing`으로 가는 POST이고 그 밖의 경로나 메서드는 없다

#### Scenario: 코드에 다른 요청이 없음
- **WHEN** 모듈 소스에서 HTTP 호출 지점과 메서드 이름을 검색한다
- **THEN** HTTP 호출은 한 파일의 한 곳이고 `PUT`, `PATCH`, `DELETE`, 테이블 경로(`/rest/v1/archi_`)가 없다

### Requirement: 저장하는 값과 저장하지 않는 값
시스템은 브리핑 날짜(한국 시간 기준), 한 줄 요약, 본문, 브리핑이 언급한 논문의 항목 번호(`itemKey`) 목록, 브리핑 주인 번호만 보내야 한다(SHALL). 메일 본문, 보낸 사람, 알림 내용, 접속 키는 보내지 않아야 한다(SHALL NOT). 본문은 카톡으로 나가는 말풍선과 같은 범위(제목까지)여야 한다(SHALL).

#### Scenario: 보내는 값
- **WHEN** 브리핑 한 건을 저장한다
- **THEN** 요청 본문에는 `date`, `summary`, `body`, `itemKeys`, `userId` 다섯 가지만 들어 있다

#### Scenario: 소스 내용의 범위
- **WHEN** 메일, GitHub, 폴리오가 읽힌 날의 브리핑을 저장한다
- **THEN** 본문에는 메일 제목, GitHub 제목, 논문 제목까지만 있고 메일 본문, 보낸 사람, 알림 내용은 없다

### Requirement: 길이 제한과 입력 검증
시스템은 요약이 1~200자, 본문이 1~20,000자, `itemKeys`가 0~50개, 날짜가 `YYYY-MM-DD`이고 실제 있는 날일 때만 저장 요청을 보내야 한다(SHALL). 범위를 벗어나면 요청을 보내지 않고 `validation_error`로 알려야 하며, 말없이 자르지 않아야 한다(SHALL NOT).

#### Scenario: 본문이 너무 김
- **WHEN** 본문이 20,000자를 넘는 브리핑을 저장하려 한다
- **THEN** 요청이 나가지 않고 `validation_error`가 나온다

#### Scenario: 없는 날짜
- **WHEN** 날짜가 `2026-02-30`이다
- **THEN** 요청이 나가지 않고 `validation_error`가 나온다

### Requirement: 같은 날 다시 저장하면 그날 한 건을 덮어쓴다
시스템은 같은 주인의 같은 날짜 브리핑을 다시 저장하면 새 건을 만들지 않고 그 한 건의 요약, 본문, 논문 목록을 새 값으로 바꿔야 한다(SHALL). 다른 날짜나 다른 주인의 브리핑은 바뀌지 않아야 한다(SHALL NOT). 응답은 그 브리핑의 번호(`id`)를 돌려줘야 한다(SHALL).

#### Scenario: 강제 재실행
- **WHEN** 오늘 브리핑이 이미 저장된 상태에서 같은 날 다시 저장한다
- **THEN** 브리핑은 여전히 오늘 한 건이고 내용이 새 값이며 번호는 이전과 같다

#### Scenario: 다른 날은 그대로
- **WHEN** 오늘 브리핑을 다시 저장한다
- **THEN** 어제와 그 이전 날짜의 브리핑은 바뀌지 않는다

### Requirement: 드라이런이거나 꺼져 있으면 아무것도 보내지 않는다
시스템은 드라이런이거나 저장 설정이 꺼져 있으면 DB에 어떤 요청도 보내지 않아야 한다(SHALL NOT). 드라이런은 입력 검증만 하고 "저장할 예정"의 결과를 돌려줘야 한다(SHALL).

#### Scenario: 드라이런
- **WHEN** 드라이런으로 저장을 호출한다
- **THEN** 요청이 하나도 나가지 않고 검증 결과만 돌아온다

#### Scenario: 설정이 꺼짐
- **WHEN** 저장 설정이 꺼진 채로 하루 실행을 한다
- **THEN** 저장 요청이 없고 카톡 전송은 지금과 같다

### Requirement: 저장 실패는 카톡 전송을 막지 않는다
시스템은 저장이 실패해도 카톡 브리핑을 보내야 한다(SHALL). 실패는 오류 코드로 구분해 브리핑의 실패 구역과 로그에 남겨야 하고(SHALL), 로그에는 건수와 소요 시간만 있고 브리핑 내용이 없어야 한다(SHALL). 저장에 성공하고 앱 주소가 설정돼 있으면 카톡에 `<앱 주소>/log/<브리핑 번호>` 링크를 덧붙여야 하고, 앱 주소가 비어 있거나 저장이 실패하면 링크를 덧붙이지 않아야 한다(SHALL).

#### Scenario: DB가 응답하지 않음
- **WHEN** 저장 요청이 서버 장애로 실패한다
- **THEN** 카톡 브리핑은 그대로 나가고 실패 구역에 "브리핑 기록 저장 실패(서버 일시 장애)"가 보인다

#### Scenario: 저장 성공과 링크
- **WHEN** 저장에 성공했고 앱 주소가 설정돼 있다
- **THEN** 카톡 말풍선 끝에 그 브리핑의 링크가 한 줄 붙는다

#### Scenario: 앱 주소가 없음
- **WHEN** 저장에 성공했지만 앱 주소 설정이 비어 있다
- **THEN** 링크 없이 저장만 되고 오류는 나지 않는다

### Requirement: 키를 보호하고 오류를 구분해서 알린다
시스템은 접속 키를 응답, 오류 메시지, 로그에 남기지 않아야 한다(SHALL NOT). 키가 틀림(`auth_error`), DB 함수가 없음(`function_missing`), 주인 번호를 모름(`user_unknown`), 입력 오류(`validation_error`), 서버 일시 장애(`server_unavailable`)를 구분된 오류로 알려야 한다(SHALL). 접속 주소는 HTTPS만 허용하고 `localhost`는 예외로 한다(SHALL). 서버 일시 장애와 요청 한도 초과(429)는 같은 날짜 덮어쓰기라 안전하므로 정해진 횟수만 다시 시도해야 한다(SHALL).

#### Scenario: 인증 오류
- **WHEN** 키가 틀려 서버가 거부한다
- **THEN** `auth_error`로 구분해서 알리고 키 값을 출력하지 않는다

#### Scenario: DB 함수가 아직 없음
- **WHEN** Archi Studio 쪽에 `archi_save_briefing` 함수가 만들어지지 않았다
- **THEN** `function_missing`으로 구분해서 알리고 재시도하지 않는다

#### Scenario: 평문 주소
- **WHEN** 접속 주소가 `http://`이고 `localhost`가 아니다
- **THEN** 요청을 보내기 전에 설정 오류로 거부한다

#### Scenario: 일시 장애 재시도
- **WHEN** 서버가 처음 두 번은 503을, 세 번째는 성공을 돌려준다
- **THEN** 브리핑은 한 건만 저장되고 성공으로 끝난다
