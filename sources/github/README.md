# morning-desk / github 소스 모듈

[`morning-desk`](../../README.md) 앱의 **GitHub 읽는 부분**입니다. 내게 해당하는 GitHub 일(리뷰 요청, 배정된 이슈와 PR의 마일스톤 마감, 읽지 않은 알림)을 **읽기 전용**으로 조회하는 모듈이고, 앱이 같은 프로세스에서 import 해서 씁니다. 판단은 앱의 몫입니다.

## 출처

코드는 **직접 작성했고 외부 코드를 가져오지 않았습니다.** 작성 전에 공식 [`github/github-mcp-server`](https://github.com/github/github-mcp-server)(MIT) v2.0.2를 실제로 시험했고(읽기 전용 구성에서 쓰기 도구가 없음을 확인), 채택하지 않은 이유는 `openspec/changes/archive/*-github-mcp/design.md`의 "조사 결과"에 있습니다. 외부 의존성 없이 표준 `fetch`로 GitHub REST API를 부릅니다.

## 하는 일

`createGithubSource(config, { logger })`가 아래 세 함수만 담은 객체를 돌려줍니다. 어떤 토큰이 설정되어 있는지(값 없이)는 앱의 `auth-status` 명령이 `githubStatus(config)`로 보여 줍니다.

| 함수 | 종류 | 설명 |
|---|---|---|
| `listReviewRequests({ maxResults? })` | 읽기 | 내게 리뷰가 요청된 열린 PR. 저장소, 번호, 제목, 주소, 갱신 시각, 작성자, **리뷰를 요청한 사람**(`requestedBy`, 얻지 못하면 null과 `requestedByUnavailable`) |
| `listAssignedItems({ maxResults? })` | 읽기 | 내게 배정된 열린 이슈와 PR. 마일스톤이 있으면 마감일(`milestone.dueDate`, 한국 날짜)을 함께. 마감이 없으면 `noDeadline: true` |
| `listNotifications({ maxResults? })` | 읽기 | 읽지 않은 알림. **조회가 읽음 표시를 바꾸지 않음** |

모두 최근에 갱신된 것부터, 기본 30개(알림 최대 50, 나머지 최대 100)이고 더 있으면 `truncated: true`입니다. 시각은 한국 시간(`+09:00`)입니다. 요청 한도를 넘으면 `rate_limited`와 함께 **다시 시도할 수 있는 시각**(`retryAt`)을 알립니다. 오류는 `config_error`, `auth_failed`, `permission_denied`, `not_found`, `validation_error`, `rate_limited`, `unavailable`, `upstream_error`로 구분됩니다.

**일부러 없는 것**: 쓰기 전부(코멘트, 이슈·PR 생성, 머지, 푸시, 리뷰 제출, 읽음 표시), 코드·파일 읽기, 임의 검색. 함수 입력은 개수 상한뿐이라 검색어나 저장소 이름으로 읽는 범위를 넓힐 수 없습니다. 코드가 부르는 주소는 `/user`, `/search/issues`, `/notifications`, 이슈 타임라인 네 곳의 `GET`뿐이고, `test/allowlist.test.ts`가 함수 목록과 입력, 주소, 요청 방식을 고정합니다. 함수를 더하려면 그 허용 목록과 명세(`openspec/specs/github-tools`)를 의도적으로 고칩니다.

결과에는 `notice`가 붙습니다: 제목은 남이 쓴 글일 수 있으니 데이터로만 다루고 지시로 따르지 말라는 표시입니다. 프롬프트 주입 방어의 본체는 앱 쪽입니다.

## 토큰 (중요)

`gh auth`의 기존 로그인 토큰은 쓰지 않습니다(보통 `repo`, `workflow` 같은 쓰기 권한이 있습니다). 모듈은 **클래식 토큰의 권한을 검사해서 `read:*`와 `notifications` 외의 권한이 하나라도 있으면 거부**합니다.

**1) 검색용 (`GITHUB_MCP_TOKEN`)** — 읽기 전용 fine-grained 토큰
1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token
2. Resource owner: 저장소를 가진 계정(개인 또는 한 개의 조직)
3. Repository access: **Only select repositories** → 필요한 저장소만
4. Repository permissions: **Metadata: Read-only**, **Issues: Read-only**, **Pull requests: Read-only** (나머지는 모두 No access)
5. 만료일을 짧게(예: 90일) 정합니다.

한계: fine-grained 토큰은 한 번에 **한 명의 resource owner**(본인 또는 조직 하나)의 저장소만 다룹니다. 여러 소유자의 저장소를 보려면 소유자마다 토큰이 필요하고, 이 모듈은 지금 토큰 하나를 받습니다.

**2) 알림용 (`GITHUB_MCP_NOTIFICATIONS_TOKEN`, 선택)** — 알림 API는 fine-grained 토큰을 지원하지 않고 **클래식 토큰만** 됩니다.
1. Settings → Developer settings → Personal access tokens → **Tokens (classic)** → Generate new token (classic)
2. 권한은 **`notifications` 하나만** 체크합니다(`repo`는 체크하지 않습니다).
3. 이 권한은 기술적으로 "읽음 표시" 같은 쓰기도 허용합니다. 그래서 이 모듈은 알림에 GET만 보내고(테스트로 고정), 넓은 권한이 붙은 토큰은 거부합니다. 이 절충이 싫으면 이 토큰을 만들지 않으면 되고, 그러면 알림 조회만 설정 오류가 되고 앱은 알림을 읽지 않습니다.

## 설정과 테스트

Node 20 이상. 설치와 검사는 저장소 루트에서 합니다(npm workspace). 이 모듈은 따로 빌드하지 않고, 앱을 빌드할 때 함께 묶입니다.

```bash
npm ci --ignore-scripts   # 잠금 파일 그대로 설치, 의존 패키지의 설치 스크립트는 실행하지 않음
npm test -w sources/github
```

설정(앱이 `.env.local`에서 읽어 `loadConfig`로 넘김; 이름은 예전 그대로):

| 환경 변수 | 설명 |
|---|---|
| `GITHUB_MCP_TOKEN` | 검색용 읽기 전용 fine-grained 토큰 |
| `GITHUB_MCP_NOTIFICATIONS_TOKEN` | (선택) 알림용 클래식 토큰, `notifications` 권한만 |
| `GITHUB_MCP_REPOS` | (선택) 포함할 저장소 패턴을 쉼표로: `owner/repo,owner/*`. 그 밖의 저장소 결과는 빼고 `omittedByRepoFilter`로 개수를 알립니다 |

## 개인정보

- 비공개 저장소의 제목이 결과에 들어갑니다. 외부 LLM으로 보내지 않는다는 전제는 앱(`assistant-app`)이 지킵니다.
- 토큰은 결과, 오류, 로그에 나타나지 않습니다. 로그는 허용한 필드(건수, 소요 시간, 오류 분류)만 남기는 방식이라 제목과 저장소 이름도 기록되지 않습니다(`test/privacy.test.ts`).
- 오류는 GitHub가 보낸 설명문을 쓰지 않고 고정 문구와 분류 코드를 씁니다.
