# Spec Delta

## MODIFIED Requirements

### Requirement: 토큰은 루트의 .env.local에 서버마다 정해진 키로 저장한다
시스템은 각 소스 모듈의 토큰을 저장소 루트의 `.env.local`에 `KEY=VALUE` 한 줄로 저장해야 한다(SHALL). 소스 모듈은 자기에게 정해진 키만 읽고 쓸 수 있어야 하고(SHALL), 다른 소스의 키를 읽거나 바꾸지 않아야 한다(SHALL NOT). 값은 줄바꿈이 없는 한 줄이어야 한다(SHALL).

#### Scenario: 자기 키만 다룬다
- **WHEN** 카카오 모듈이 새 리프레시 토큰을 저장한다
- **THEN** `KAKAO_REFRESH_TOKEN` 줄만 바뀌고 Gmail, To Do, GitHub의 줄은 그대로다

#### Scenario: 다른 서버의 키를 요청함
- **WHEN** 한 소스 모듈의 코드가 자기에게 정해지지 않은 키를 읽거나 쓰려 한다
- **THEN** 파일을 열기 전에 오류가 난다

#### Scenario: 긴 토큰
- **WHEN** 여러 줄로 된 토큰 캐시를 저장한다
- **THEN** 한 줄로 인코딩되어 저장되고, 다시 읽으면 원래 내용과 같다

### Requirement: 파일 위치를 설정할 수 있다
시스템은 `MY_TASK_ENV_FILE`에 적힌 경로의 파일을 써야 한다(SHALL). 설정이 없으면 앱이 설치된 저장소의 루트에 있는 `.env.local`을 써야 한다(SHALL). 파일이 없으면 로그인이 필요하다고 알려야 한다(SHALL).

#### Scenario: 비서가 띄운 서버
- **WHEN** `MY_TASK_ENV_FILE`을 설정하고 앱을 실행한다
- **THEN** 모든 소스 모듈이 그 파일에서 토큰을 읽고 그 파일에 고쳐 쓴다

#### Scenario: 직접 실행한 서버
- **WHEN** 설정 없이 앱이나 로그인 명령을 실행한다
- **THEN** 저장소 루트의 `.env.local`을 쓴다
