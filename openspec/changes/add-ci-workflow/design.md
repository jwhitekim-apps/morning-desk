# Design

## Context

동기와 범위는 proposal.md를 본다. 이 문서는 2026-10-17에 읽기와 격리된 복제본 실행으로 확인한 사실, 결정, 확인하지 못한 점을 적는다.

**확인한 현재 상태**
- 저장소에 `.github/`가 없고, 원격의 워크플로가 0개다. 원격 Actions는 켜져 있고(`allowed_actions: all`), 기본 워크플로 권한은 읽기(`default_workflow_permissions: read`), `sha_pinning_required`는 꺼져 있다.
- 루트 `package.json`: npm workspace(`shared`, `sources/*`, `app`), `engines.node >=20`, scripts는 `typecheck`, `lint`, `test`, `build`. `app/tsup.config.ts`의 빌드 대상은 `node20`이다. 린트는 루트에서 `eslint .` 한 번이다.
- 서버(운영)의 Node는 **v24.21.0**이고, 맥북의 Node는 **v25.9.0**이다. 세 곳(최소 20, 운영 24, 로컬 25)이 모두 다르다.
- 다른 프로젝트 `naver-blog-to-kakao-map`의 Actions 실행은 47~60초 걸렸다(공개 저장소, 배포 작업이라 우리 CI와 직접 비교는 안 된다).

## Goals / Non-Goals

**Goals:**
- 푸시와 풀 리퀘스트마다 네 명령을 깨끗한 환경에서 자동으로 돌린다.
- 외부 의존(액션)을 최소로 하고 고정해서 공급망 위험을 줄인다.
- 비밀과 쓰기 권한 없이 돈다.

**Non-Goals:**
- 배포, 산출물 업로드, 서버 접속(`deploy-via-actions`의 일).
- 브랜치 보호와 필수 검사, 배지, 액션 자동 갱신, 의존성 취약점 정리.

## 조사 결과 (깨끗한 복제본에서 확인)

`git clone`으로 받은 복제본(커밋 `75fb215`, 작업 폴더에서 git이 제외하는 파일 없음)을 저장소 밖의 임시 폴더에 두고, CI가 돌릴 명령을 그대로 실행했다. 원본 저장소는 건드리지 않았다.

| 확인 | 결과 |
|---|---|
| `npm ci --ignore-scripts` | 통과 (npm 캐시가 따뜻한 상태라 1.3초. 러너에서의 시간은 아니다) |
| `npm run typecheck` | 통과, 8개 워크스페이스 모두, 5초 |
| `npm run lint` | 통과, 1초 |
| `npm test` | 통과, **527개** (shared 17, folio 49, github 59, gmail 70, kakao 61, microsoft-todo 79, server 44, app 148), 11초 |
| `npm run build` | 통과, 2초 (`app/dist/index.js` 146KB) |
| 러너와 비슷한 환경(`TZ=UTC`, `CI=true`, 빈 `HOME`, `LANG=C.UTF-8`)에서 같은 네 명령 | 모두 통과, 테스트 527개 그대로 (이 앱은 한국 시간 처리가 많아 러너의 UTC에서 깨질 위험이 있었다) |
| 바깥으로 나가는 연결을 막고(저장소 밖의 사전 로드 스크립트로 루프백 외 `connect`를 차단, 메인 스레드와 워커 모두 차단되는 것을 확인) `npm test` | 통과 527개, 차단된 연결 시도 **0건** |
| git이 추적하는 경로 중 대소문자만 다른 충돌 | 없음 |

명령 실행 시간 합계는 약 20초다. 러너에서는 체크아웃, Node 설치, 캐시 복원, `npm ci`가 더해져서 한 번에 **1~2분**일 것으로 **추정**한다(러너에서 측정하지 않았다. 첫 실행 결과로 확정한다, 작업 3.2).

**발견 (이 변경에서 고치지 않음)**
- `npm audit`: 8건(치명 2, 높음 1, 보통 5). 치명·높음은 모두 개발 도구(`vitest`, `tinypool`, `vite`)이고 `npm audit --omit=dev`로 보면 운영 의존성은 보통 2건(`@azure/msal-node`, `uuid`)이다. 모두 `npm`이 고칠 수 있다고 표시했으나 고치면 버전이 오르므로 별도 변경에서 다룬다. 이번 CI에는 `npm audit` 단계를 넣지 않는다(지금 넣으면 처음부터 빨갛게 된다).

## Decisions

### 1. 워크플로 하나, job 하나, 순서는 AGENTS.md 그대로
`typecheck → lint → test → build` 순서다. 한 job으로 하는 이유: 설치와 캐시 복원을 한 번만 하고, 합계가 약 20초라 병렬로 나눌 이득이 없다. 단점은 앞 단계가 실패하면 뒤 단계를 보지 못하는 것인데, 단계마다 이름을 붙이면 어디서 실패했는지는 바로 보인다.

### 2. 트리거와 중복 실행
`push`는 `main`만, `pull_request`는 모든 대상에서 실행한다. 풀 리퀘스트용 브랜치에 푸시하면 `pull_request`로만 돌아서 같은 커밋이 두 번 돌지 않는다. `pull_request_target`은 쓰지 않는다(비밀이 필요 없고, 비공개 저장소라 포크도 없다). `concurrency`는 `group: ci-${{ github.ref }}`에 `cancel-in-progress: true`로 두어 같은 브랜치의 이전 실행을 취소한다. CI는 검사뿐이라 취소해도 잃는 것이 없다(배포가 생기면 그때 다시 정한다).

### 3. 권한과 비밀
워크플로 최상위에 `permissions: contents: read`. 체크아웃에 `persist-credentials: false`를 둔다(이후 git 쓰기가 없으므로 토큰을 디스크에 남기지 않는다). 비밀(`secrets.*`)은 쓰지 않는다. 테스트는 외부에 접속하지 않으므로(위 조사) 어떤 키도 필요 없다.

### 4. Node 20, npm 캐시
`setup-node`에 `node-version: 20`, `cache: npm`을 **명시**한다. 이유: `engines`가 `>=20`이고 빌드 대상이 `node20`이라 20이 지원하는 최소 버전이며, 지금까지 20으로 돌려 본 적이 없다(운영 24, 로컬 25에서만 확인). 그래서 CI의 20이 가장 새로운 정보를 준다. `package.json`에 `packageManager` 필드가 없어서 `setup-node`의 자동 캐시(`package-manager-cache` 기본 true)는 동작하지 않으므로 `cache: npm`을 직접 적는다. 의존성 파일은 기본값인 루트 `package-lock.json`이고 존재한다. 운영 Node인 24도 함께 돌릴지는 열린 질문 1.

### 5. 외부 액션: 공식 둘만, 전체 SHA로 고정
`gh api`로 읽어 확인했다(`releases/latest`, `git/matching-refs/tags`, `commits/<태그>`). 두 태그 모두 가벼운(lightweight) 태그라 태그가 가리키는 SHA가 곧 커밋 SHA다.

| 액션 | 태그 | 전체 커밋 SHA | 커밋 날짜 |
|---|---|---|---|
| `actions/checkout` | `v7.0.1` | `3d3c42e5aac5ba805825da76410c181273ba90b1` | 2026-07-17 |
| `actions/setup-node` | `v7.1.0` | `949feb2413d6458794dcd2491c4babbbce0c15c1` | 2026-10-08 |

둘 다 `action.yml`의 실행 환경이 `node24`다(GitHub 호스팅 러너가 지원). 두 액션은 GitHub 공식 조직(`actions`)이 관리한다. 구현 시점에 최신 태그가 바뀌었으면 같은 방법으로 다시 읽고 SHA를 갱신한다(SHA를 지어내지 않는다). 자동 갱신 도구는 범위 밖이므로 갱신은 수동이다.

**읽은 범위와 결과 (2026-10-17, 작업 1.3)**: 고정 SHA 시점의 `action.yml`, 저장소 트리, `src/` 전체(checkout 18개, setup-node 17개)를 읽고, 번들 `dist/`는 `child_process`·`eval`·`https://` 호스트·토큰 이름을 grep으로만 확인했다(번들 전체를 읽지는 않았다). 두 저장소 모두 `actions` 조직(Organization)이다. 접속 대상은 github.com, api.github.com(`GITHUB_SERVER_URL`·`GITHUB_API_URL` 기본값), setup-node의 `nodejs.org`(Node 배포 목록, 매니페스트는 GitHub `node-versions`)와 Actions 캐시(Azure Blob `*.blob.core.windows.net`)뿐이고 예상 밖의 호스트는 없다. `child_process`는 쓰지 않고 `@actions/exec`로 `git`(checkout)과 `node --version`·`npm config get cache`(setup-node)만 실행한다. checkout의 `token`(기본 `github.token`)은 가져오는 동안 로컬 git 설정의 `http.<서버>/.extraheader`에 쓰이고, `persist-credentials: false`면 가져온 뒤 지워 디스크에 남기지 않는다. setup-node의 `token`은 Node 배포 목록을 받을 때의 인증에만 쓰이며, `.npmrc`와 `NODE_AUTH_TOKEN`은 `registry-url`을 줄 때만 쓰는데 우리는 주지 않는다. 난독화, `eval`, 설치 후 미고정 코드 내려받기는 보이지 않았다. 의심스러운 점 없음.

### 6. 러너와 시간 제한
`runs-on: ubuntu-latest`(다른 프로젝트의 워크플로도 같은 것을 쓴다). 이미지가 바뀌면 결과가 달라질 수 있다는 단점이 있고, 필요해지면 특정 버전 라벨로 고정한다. `timeout-minutes: 10`: 예상 1~2분의 몇 배로, 멈춘 실행이 분량을 먹는 것을 막는다.

### 7. 설계 초안 (구현 전, 이 모양으로 쓴다)
```yaml
name: CI
on:
  push: { branches: [main] }
  pull_request:
permissions:
  contents: read
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with: { persist-credentials: false }
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with: { node-version: 20, cache: npm }
      - run: npm ci --ignore-scripts
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: npm run build
```
단계 이름은 구현할 때 한국어 또는 영어로 붙인다. 산출물 업로드는 하지 않는다.

## Risks / Trade-offs

- **[비공개 저장소의 Actions 분량]** 계정 요금제와 월 한도, 사용량은 확인하지 못했다(`gh`로 요금제를 읽을 권한이 없었다). 한 번에 1~2분(추정)이라 실행당 부담은 작지만 한도를 모르는 채 켜는 셈이다. → 작업 3.4에서 소유자가 GitHub 설정의 사용량 화면에서 확인한다. 한도를 넘으면 실행이 멈추거나 요금이 날 수 있는지는 모른다.
- **[Node 20 미검증]** 깨끗한 복제본 시험은 Node 25에서 했다. → CI의 첫 실행이 Node 20 검증이다(작업 3.2). 실패하면 원인(예: Node 21 이상에만 있는 기능)을 보고 코드를 고치는 별도 작업으로 다룬다.
- **[Linux 러너와 맥북의 차이]** 맥북의 파일 시스템은 대소문자를 구분하지 않아서, 가져오기 경로의 대소문자 오타는 로컬에서 통과하고 Linux에서 실패할 수 있다. git이 추적하는 경로에 대소문자 충돌은 없지만 가져오기 경로 오타는 맥북에서 시험할 수 없다. → 첫 실행으로 확인한다.
- **[공급망]** 외부 액션 둘. → 공식 액션만, 전체 SHA 고정, 읽기 권한만, 비밀 없음. 고정한 SHA는 자동으로 갱신되지 않아서 오래되면 보안 수정이 늦어진다(수동 갱신, 후속 과제).
- **[거짓 안전감]** CI가 통과해도 실제 계정 호출이나 서버 환경은 검증하지 않는다(테스트가 모두 모의 서비스를 쓰므로). → 문서에 "CI는 모의 서비스로 하는 검사"라고 밝힌다(작업 2.3).
- **[시간대]** 러너는 UTC다. 시험은 `TZ=UTC`에서 통과했지만 러너에서 다시 확인한다.

## Migration Plan

1. 맥북에서 `ci.yml`과 문서를 쓰고 로컬에서 문법을 검증한다(작업 2.x). 커밋은 하나(`ci: add GitHub Actions workflow`)로 한다.
2. 소유자가 브랜치나 풀 리퀘스트로 푸시해 첫 실행을 본다(작업 3.1~3.2). `main`에 바로 푸시해도 되지만 첫 실행은 브랜치가 안전하다.
3. 실패하는 변경을 일부러 올려 CI가 실제로 빨갛게 되는지 한 번 본다(작업 3.3).
4. 되돌리기: `.github/workflows/ci.yml` 파일을 지우는 커밋 하나면 끝난다. 다른 시스템에는 영향이 없다.

## Open Questions

1. **운영 Node 24도 함께 돌릴까?** **결정됨 (2026-10-17, 소유자: Node 20만)**. 지금은 Node 20만 돌린다. 운영이 24라서 `[20, 24]` 행렬이 더 안전하지만 비공개 저장소의 분량이 두 배로 들기 때문이다. 24 추가 여부는 한도를 확인한 뒤(작업 3.4) 다시 정한다.
2. **저장소 설정 `sha_pinning_required`를 켤까?** 켜면 SHA로 고정하지 않은 액션이 실행되지 않는다. 지금 계획과 맞지만 저장소 설정 변경이라 이 변경의 범위 밖이다. 소유자가 원하면 설정에서 직접 켠다(선택).
3. **브랜치 보호(필수 검사)**: 범위 밖. CI가 한 번 초록으로 도는 것을 본 뒤에 소유자가 정한다.

## 첫 실행 결과 (2026-10-17)

PR #1(https://github.com/jwhitekim/morning-desk/pull/1)의 첫 실행은 **실패**했다. 총 약 45초(생성 06:22:27 ~ 06:23:12). 단계별: 체크아웃 0초, setup-node(캐시 복원 포함) 6초, `npm ci` 3초, typecheck 14초, lint 2초, test 11초(실패), build는 건너뜀. 가장 긴 단계는 typecheck. 실패 원인은 `shared`의 `env-file-concurrency` 테스트 2개: 자식 프로세스가 `.ts` 파일을 직접 실행하는데 Node 20이 `ERR_UNKNOWN_FILE_EXTENSION`으로 거부한다. 그 밖의 테스트(`app` 148개, 다른 작업공간 44개 등)는 통과했다. 그래서 테스트 527개 통과 기준은 아직 확인하지 못했고, 작업 3.5에서 고친다.

