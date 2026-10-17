# Tasks

## 1. 사전 확인

- [x] 1.1 깨끗한 복제본에서 CI가 돌릴 네 명령을 그대로 실행한다. 검증: `npm ci --ignore-scripts`, `typecheck`, `lint`, `test`(527개), `build`가 모두 통과했고, `TZ=UTC`·`CI=true`·빈 `HOME`에서도, 바깥 연결을 막은 상태(차단 시도 0건)에서도 같은 결과다. 결과 표는 design.md의 "조사 결과". (2026-10-17 완료. 구현 직전에 `main`이 바뀌었으면 같은 확인을 한 번 더 한다)
- [x] 1.2 사용할 두 액션의 태그와 전체 커밋 SHA를 `gh api`로 읽어 확인한다. 검증: `actions/checkout` `v7.0.1` = `3d3c42e5aac5ba805825da76410c181273ba90b1`, `actions/setup-node` `v7.1.0` = `949feb2413d6458794dcd2491c4babbbce0c15c1`이 design.md 결정 5에 있다. (2026-10-17 완료. 구현 시점에 최신 태그가 바뀌었으면 같은 방법으로 다시 읽는다)
- [x] 1.3 고정할 두 액션의 `action.yml`과 진입 코드(번들이 아닌 소스 위주)를 고정 SHA 시점으로 읽어 접속 대상, `child_process` 사용, 토큰 사용을 확인한다(`AGENTS.md`의 서드파티 코드 규칙). 검증: design.md 결정 5에 "읽은 범위와 결과" 한 줄이 추가되어 있고, 의심스러운 점이 있으면 그 액션을 쓰지 않는 대안이 적혀 있다 (2026-10-17 완료. 접속 호스트는 예상대로, 의심스러운 점 없음)
- [x] 1.4 열린 질문 1(Node 20만 / 20과 24)을 소유자가 정한다. 검증: design.md에 결정이 적혀 있다. 정하지 않으면 추천(20만)으로 진행한다 (2026-10-17 완료. 소유자: Node 20만)

## 2. 구현 (소유자의 "진행해" 이후)

- [ ] 2.1 `.github/workflows/ci.yml`을 design.md 결정 7의 모양으로 쓴다(트리거 `push: main`과 `pull_request`, `permissions: contents: read`, `concurrency`, `timeout-minutes: 10`, 두 액션은 전체 SHA 고정, `persist-credentials: false`, Node 20과 `cache: npm`, 네 명령 순서). 검증: 파일이 설계와 같고, 파일의 모든 `uses:`가 40자리 SHA이며, `secrets.`가 한 번도 나오지 않는다
- [ ] 2.2 로컬에서 문법을 검증한다. 검증: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"`(또는 Node의 YAML 파서)로 파싱되고, `actionlint`가 있으면 오류가 없다. 새 도구를 내려받아 설치하지는 않는다
- [ ] 2.3 `README.md`와 `AGENTS.md`의 Commands 부근에 CI 한 줄을 더한다: GitHub Actions가 `main` 푸시와 풀 리퀘스트에서 같은 네 명령을 모의 서비스로 돌리며, 실제 계정 호출과 서버 환경은 검증하지 않는다. 검증: 두 파일에 해당 문장이 있고 다른 내용은 바뀌지 않았다
- [ ] 2.4 `openspec validate add-ci-workflow --strict`가 통과하고, 변경을 커밋한다(`ci: add GitHub Actions workflow`, 푸시는 소유자 지시 후). 검증: 작업 트리가 깨끗하고 커밋에 `.env*`와 비밀값 모양의 문자열이 없다

## 3. 첫 실행 확인 (푸시 시점은 소유자가 정한다)

- [x] 3.1 브랜치나 풀 리퀘스트로 푸시한다(소유자 지시). 검증: 저장소의 Actions 화면에 CI 실행이 하나 나타난다
- [ ] 3.2 첫 실행의 결과와 소요 시간을 기록한다. 검증: 모든 단계가 통과하고(Node 20에서 테스트 527개), 총 소요 시간과 `npm ci`·캐시 복원 시간이 design.md에 적혀 있다. 실패하면 원인(Node 20, 대소문자, 시간대 등)과 고칠 작업을 이 목록에 더한다
- [ ] 3.3 일부러 실패하는 변경(예: 타입 오류 한 줄)을 다른 브랜치에 올려 CI가 빨갛게 되는지 본다. 검증: 실패한 실행이 화면에 나타나고 실패 단계가 `typecheck`로 표시된다. 시험 브랜치는 지운다
- [ ] 3.4 소유자가 GitHub 설정의 Actions 사용량 화면에서 이 비공개 저장소의 월 한도와 사용량을 확인한다. 검증: 한도와 첫 실행 이후 사용량이 design.md의 위험 항목에 기록되어 있다. 부담이 크면 Node 24 추가 여부(열린 질문 1)와 트리거 범위를 다시 정한다

## 4. 이 변경 밖의 후속 (참고, 이 변경에서 하지 않는다)

- 브랜치 보호와 필수 검사, README 배지, 액션 자동 갱신(Dependabot)
- `npm audit` 정리: 개발 도구 3건(`vitest`, `tinypool`, `vite`)과 운영 의존성 보통 2건(`@azure/msal-node`, `uuid`)의 버전 올리기와 CI에 audit 단계 추가
- `deploy-via-actions`: 이 CI를 선행 조건으로, 통과한 커밋만 서버에 배포하는 별도 변경(서버 접속 비밀 등록은 소유자 작업)
- [ ] 3.5 첫 실행 실패의 원인을 고친다(3.2 선행). 원인: `shared/test/env-file-concurrency.test.ts` 2개가 자식 프로세스로 `.ts`를 직접 실행하는데 Node 20은 `.ts`를 읽지 못한다(ERR_UNKNOWN_FILE_EXTENSION). 로컬 Node는 더 새 버전으로 보인다. 검증: Node 20에서 `npm test`가 통과하고 CI가 초록이 된다
