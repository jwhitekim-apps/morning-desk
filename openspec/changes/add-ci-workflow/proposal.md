# Proposal

## Why

이 저장소에는 CI가 없다(`.github/`가 없고, 원격의 워크플로 수가 0이다). `AGENTS.md`는 "타입 검사, 린트, 테스트, 빌드가 모두 통과해야 변경을 끝낸다"고 정하지만, 지금은 맥북에서 사람이나 에이전트가 직접 돌린 결과에 기대고 있다. 로컬 작업 폴더에는 git이 제외하는 파일(`node_modules`, `dist`, `.env.local`, `sources/server/targets.json`)이 있어서, 깨끗하게 받은 저장소에서는 실패할 일이 로컬에서는 가려질 수 있다. 이번 조사에서 깨끗한 클론에서 네 명령이 통과하는 것을 확인했으므로(527개 테스트, design.md), 같은 확인을 푸시마다 자동으로 반복하게 한다. 또한 이후에 계획된 Actions 자동 배포(`deploy-via-actions`)는 "검사를 통과한 커밋만 배포한다"는 전제가 필요해서 이 변경이 그 선행 조건이다.

## What Changes

- `.github/workflows/ci.yml` **한 개**를 추가한다. `main`에 푸시할 때와 풀 리퀘스트에서 실행한다.
- 한 job에서 순서대로: 체크아웃 → Node 설치(npm 캐시) → `npm ci --ignore-scripts` → `npm run typecheck` → `npm run lint` → `npm test` → `npm run build`. 이 네 명령은 `AGENTS.md`가 정한 것 그대로다.
- 최소 권한(`contents: read`), 비밀 사용 없음, 같은 브랜치의 이전 실행 취소(`concurrency`), 시간 제한(`timeout-minutes`).
- 사용하는 외부 액션은 공식 `actions/checkout`과 `actions/setup-node` 두 개뿐이고, 둘 다 **전체 커밋 SHA로 고정**한다(조사로 확인한 값은 design.md 결정 5).
- `README.md`와 `AGENTS.md`의 Commands 부근에 CI가 같은 네 명령을 돌린다는 한 줄을 더한다.
- **범위 밖**: 배포(이후 별도 변경 `deploy-via-actions`), 브랜치 보호와 필수 검사 설정, README 배지, 액션 버전 자동 갱신(Dependabot, renovate), `npm audit` 검사와 의존성 취약점 정리(design.md의 발견 참고), 저장소 설정 변경(예: 액션 SHA 고정 강제).

## Capabilities

### New Capabilities
<!-- 없음 -->

### Modified Capabilities
<!-- 없음 -->

앱의 관측 가능한 동작은 바뀌지 않는다. CI는 저장소를 검사하는 도구이고, 사용자나 다른 시스템이 의존하는 요구사항이 아니다. 그래서 명세를 쓰지 않고 `.openspec.yaml`에 `skip_specs: true`를 둔다(`opsx:propose` 규칙: 행동이 바뀌지 않는 변경은 명세를 만들지 않는다). 검사 기준 자체는 이미 `AGENTS.md`에 있다.

## Impact

- 추가: `.github/workflows/ci.yml`. 앱 코드, 소스 모듈, 테스트, 의존성은 바뀌지 않는다.
- 문서: `README.md`, `AGENTS.md`의 Commands 한 줄.
- 외부: GitHub Actions 사용. 저장소가 **비공개**라서 실행 시간이 계정의 Actions 분량에서 차감된다. 계정의 한도와 남은 양은 확인하지 못했다(design.md 위험).
- 서버: 영향 없음(CI는 서버에 접속하지 않고 비밀도 쓰지 않는다).
- 선행/후속: 새 구조 배포(`sources-as-modules` 7번 묶음)와 독립적으로 할 수 있다. 이 변경은 코드가 아니라 저장소 설정이라 배포 순서와 상관이 없다.
