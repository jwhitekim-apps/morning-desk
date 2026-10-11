# Spec Delta

## MODIFIED Requirements

### Requirement: 토큰과 메일 본문을 보호한다
시스템은 로그인 토큰(리프레시 토큰)을 저장소 루트의 `.env.local`(권한 600)에 `GMAIL_REFRESH_TOKEN` 키로 저장해야 한다(SHALL). OAuth 클라이언트 정보는 `.env.local`의 `GMAIL_CLIENT_ID`와 `GMAIL_CLIENT_SECRET`에서 읽어야 한다(SHALL). 토큰은 도구 응답과 로그에 나타나지 않아야 한다(SHALL NOT). 메일 본문과 제목은 로그에 남기지 않아야 한다(SHALL NOT).

#### Scenario: 토큰 파일 권한
- **WHEN** 로그인한 뒤 `.env.local`을 확인한다
- **THEN** `GMAIL_REFRESH_TOKEN` 줄이 있고 파일 권한은 600이며, 홈 폴더 아래에 토큰 파일이 만들어지지 않는다

#### Scenario: 로그에 내용이 없음
- **WHEN** 검색과 본문 읽기를 실행한 뒤 로그를 확인한다
- **THEN** 토큰, 메일 제목, 메일 본문이 없고 건수와 소요 시간 같은 값만 있다
