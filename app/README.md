# morning-desk / app

[`morning-desk`](../README.md)의 **애플리케이션**입니다. 하루 한 번(집 서버의 타이머) 실행되어 소스를 읽고, 로컬 LLM으로 일정과 할 일 후보를 찾고, 코드가 정한 규칙으로 To Do에 태스크를 추가한 뒤, 아침 브리핑을 카카오톡 "나에게 보내기"로 보냅니다.

## 구조

앱은 소스 모듈(`../sources/*`)을 **같은 프로세스에서 import 해서** 부릅니다. 자식 프로세스나 MCP 같은 프로토콜 층은 없습니다.

| 모듈 | 앱이 부르는 함수 |
|---|---|
| `@morning-desk/microsoft-todo` | `listTasksDue`, `listTaskLists`, `createTask` (그 밖에 `listTasks`, `getTask`) |
| `@morning-desk/gmail` | `searchEmails`, `readEmail` |
| `@morning-desk/github` | `listReviewRequests`, `listAssignedItems`, `listNotifications` |
| `@morning-desk/folio` | `listRecentPapers` (그 밖에 `searchPapers`) |
| `@morning-desk/kakao` | `sendManyToMe` |
| `@morning-desk/server` | `checkServices`, `checkLlm` |

- 하루 실행(`run`)이 받는 것은 이 함수들뿐입니다(`src/modules.ts`의 `SourceModules`). 각 모듈의 허용 목록은 모듈의 `test/allowlist.test.ts`가 고정하고, 앱의 `test/run.test.ts`가 "앱이 받는 함수 = 모듈 허용 목록"을 확인합니다. 로그인 함수는 하루 실행에 들어오지 않습니다.
- 모델은 후보만 냅니다. 중복 확인, 같은 스레드 합치기, 출처 문구, 실행당 상한은 코드가 정한 뒤에 `createTask`를 부릅니다.
- 소스 호출마다 제한 시간(120초)이 있고, 한 소스가 실패해도 나머지로 브리핑을 만들고 실패 구역에 원인을 적습니다.
- 서버 점검 모듈(`@morning-desk/server`)은 하루 실행에서 `checkServices`와 `checkLlm`을 호출하고, 결과를 브리핑에 반영합니다.

## 명령

설치와 빌드는 저장소 루트에서 합니다(npm workspace).

```bash
npm ci --ignore-scripts
npm run build -w app            # app/dist/index.js 하나(소스 모듈을 함께 묶음)
node app/dist/index.js --help
```

| 명령 | 하는 일 |
|---|---|
| `morning-desk run [--dry-run] [--force]` | 오늘 브리핑을 만들어 보냅니다. `--dry-run`은 읽기와 모델 호출만 하고 전송, 태스크 추가, 기록 저장을 하지 않고 브리핑을 화면에 보여 줍니다. `--force`는 오늘 이미 보냈어도 다시 보냅니다 |
| `morning-desk login todo` | To Do 기기 코드 로그인(터미널에서 직접 실행) |
| `morning-desk login gmail` | Gmail 브라우저 로그인(읽기 전용 권한, 앱이 도는 컴퓨터에서) |
| `morning-desk logout <todo\|gmail>` | `.env.local`에서 그 소스의 토큰 줄을 지웁니다 |
| `morning-desk auth-status` | 소스별 로그인·설정 상태를 있음/없음으로만 보여 줍니다(값은 출력하지 않음) |
| `morning-desk migrate-tokens [--dry-run]` | 홈 폴더의 옛 토큰 파일을 루트 `.env.local`로 옮깁니다 |

`morning-desk`는 `node app/dist/index.js`와 같습니다. 하루 실행 중에는 로그인을 시작하지 않습니다. 로그인이 필요하면 실패 구역에 `To Do 로그인 필요` 같은 줄이 나오고, 위의 `login` 명령으로 다시 로그인합니다.

## 설정

모든 값은 저장소 루트의 `.env.local`(권한 600)에 둡니다. 앱이 읽어서 소스마다 **자기 설정만** 만들어 넘깁니다. 토큰은 `# --- 토큰 (자동 갱신, 직접 고치지 마세요)` 구역에 있고 각 모듈이 자기 줄만 고쳐 씁니다.

| 이름 | 설명 |
|---|---|
| `LOCAL_LLM_BASE_URL`, `LOCAL_LLM_API_KEY`, `LOCAL_LLM_MODEL` | 로컬 모델(https만, 시험용 `LLM_ALLOW_PLAINTEXT=1`) |
| `ASSISTANT_CREATE_TASKS` | `1`이면 To Do에 실제로 추가(기본은 비교 전용) |
| `ASSISTANT_MAX_CREATES` | 한 번에 추가하는 상한(기본 10) |
| `ASSISTANT_SOURCES` | 읽을 소스(기본 `gmail,github,folio`) |
| `TODO_LIST_NAME` | 태스크를 넣을 목록(없으면 기본 목록) |
| `MAIL_QUERY` | Gmail 검색식(기본: 받은편지함, 프로모션·소셜 제외) |
| `AGENT_DIR` | 기록 파일(`memory.json`) 폴더(기본 `~/.config/my-task-agent`) |

소스별 설정은 각 모듈의 README를 봅니다.

## 개인정보

메일, 이슈, 논문, 태스크 내용은 로컬 모델로만 보냅니다. 로그에는 건수와 소요 시간만 남기고 내용은 남기지 않습니다. 소스 내용은 데이터로만 다루고, 그 안의 지시는 따르지 않습니다(`test/injection.test.ts`).
