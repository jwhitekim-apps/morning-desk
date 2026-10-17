# morning-desk

개인 비서 애플리케이션입니다. **태스크 앱(Microsoft To Do)을 입력 창구**로 두고, 메일·GitHub·폴리오는 **감지용 데이터 소스**로 읽어서, 하루 한 번 로컬 LLM으로 일정과 할 일을 찾아 To Do에 추가하고 아침 브리핑을 카카오톡 "나에게 보내기"로 보냅니다.

## 구조

```
morning-desk/
  app/                 애플리케이션(CLI `morning-desk`): 하루 실행, 로그인, 상태 확인
  sources/
    microsoft-todo/    To Do 모듈 (읽기 + 태스크 추가만)
    gmail/             Gmail 모듈 (읽기 전용)
    github/            GitHub 모듈 (읽기 전용)
    folio/             폴리오 논문 목록 모듈 (읽기 전용)
    kakao/             카카오톡 나에게 보내기 모듈
    server/            집 서버·학교 LLM 점검 모듈 (아직 하루 실행에 연결되지 않음)
  shared/              공통 코드(.env.local 토큰 줄 읽고 쓰기, 로거, 오류 바탕)
  openspec/            계획서, 스펙 (OpenSpec)
```

앱은 소스 모듈을 **같은 프로세스에서 import 해서** 부릅니다(npm workspace). 각 모듈은 허용된 함수만 내보내고, 앱이 하루 실행에서 받는 것도 그 함수들뿐입니다. 소스끼리는 서로 모릅니다. 처음에는 각 소스를 MCP 서버로 만들었지만, 모델이 도구를 고르지 않고 코드가 정해진 순서로 부르는 구조라 모듈로 바꿨습니다(`openspec/changes/sources-as-modules`).

## 설치와 검사

Node 20 이상. 저장소 루트에서 합니다.

```bash
npm ci --ignore-scripts   # 잠금 파일 그대로 설치, 의존 패키지의 설치 스크립트는 실행하지 않음
npm run typecheck && npm run lint && npm test && npm run build
node app/dist/index.js --help
```

명령과 설정은 [`app/README.md`](app/README.md), 소스별 설정은 각 모듈의 README를 봅니다. 비밀값과 토큰은 저장소 루트의 `.env.local`(권한 600, git 제외)에만 둡니다.

## 현재 상태

- 타입 검사, 린트, 테스트(모의 데이터만, 네트워크 없음), 빌드가 통과합니다.
- 집 서버 배포, 학교 LLM의 HTTPS 연결, 로컬 모델 품질 측정, 이전 시스템과의 병행 비교는 남아 있습니다. 진행 상황은 `openspec/changes/assistant-app/tasks.md`와 `openspec/changes/sources-as-modules/tasks.md`에 있습니다.

## 출처 (Credits)

`sources/microsoft-todo`는 **[fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)**(© 2026 Fabien Butz, MIT)를 바탕으로 필요한 부분만 골라 고친 것입니다. 기준 커밋, 원본 대비 변경, 라이선스는 [`sources/microsoft-todo/README.md`](sources/microsoft-todo/README.md), [`CHANGELOG.md`](sources/microsoft-todo/CHANGELOG.md), [`LICENSE`](sources/microsoft-todo/LICENSE)에 있습니다.

## 라이선스

이 프로젝트는 MIT 라이선스입니다([`LICENSE`](LICENSE)). `sources/microsoft-todo`에는 fabienbutz/microsoft-todo-mcp에서 가져와 고친 코드가 있고, 그 부분은 원본의 MIT 라이선스([`sources/microsoft-todo/LICENSE`](sources/microsoft-todo/LICENSE))를 따릅니다.

## 개발 규칙

- 작업은 OpenSpec으로 관리합니다. `/opsx:propose`로 계획서를 쓰고 **검토를 받은 뒤** 구현합니다.
- 앱에 주는 함수는 **읽기와 추가**뿐이고, 수정·삭제 함수는 코드에 두지 않습니다(숨김 설정이 아니라 아예 없음).
- 비밀값(토큰, 키)은 저장소와 대화에 넣지 않습니다. `.env*`는 git이 무시합니다.
