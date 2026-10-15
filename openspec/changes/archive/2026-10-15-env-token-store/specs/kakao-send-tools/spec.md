# Spec Delta

## MODIFIED Requirements

### Requirement: 토큰을 갱신하고 새 리프레시 토큰을 이어 쓴다
시스템은 액세스 토큰이 만료되었거나 전송이 인증 오류로 거부되면 갱신해서 한 번만 재시도해야 한다(SHALL). 갱신 응답에 새 리프레시 토큰이 있으면 저장소 루트의 `.env.local`(권한 600)의 `KAKAO_REFRESH_TOKEN` 줄을 그 값으로 고쳐 써서 다음 실행에서 이어 써야 한다(SHALL). 토큰은 도구 응답과 로그에 나타나지 않아야 한다(SHALL NOT).

#### Scenario: 만료된 액세스 토큰
- **WHEN** 액세스 토큰이 만료된 상태로 전송한다
- **THEN** 갱신한 뒤 전송에 성공한다

#### Scenario: 새 리프레시 토큰
- **WHEN** 갱신 응답에 새 리프레시 토큰이 들어 있다
- **THEN** `.env.local`의 `KAKAO_REFRESH_TOKEN` 줄이 새 값으로 바뀌고 다음 실행에서는 그 값을 쓴다

#### Scenario: 리프레시 토큰이 만료됨
- **WHEN** 리프레시 토큰이 더는 유효하지 않다
- **THEN** 전송하지 않고 카카오 로그인을 다시 해야 한다는 오류를 알린다
