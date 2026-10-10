# my-task

개인 비서 프로젝트입니다. **태스크 앱(Microsoft To Do)을 입력 창구**로 두고, 메일·GitHub·폴리오는 **감지용 데이터 소스**로 읽어서, 로컬 LLM 에이전트가 일정과 할 일을 찾아 브리핑하는 것이 목표입니다. 각 소스는 MCP(Model Context Protocol) 서버로 분리합니다.

## 구조

```
my-task/
  mcp/
    microsoft-todo/   Microsoft To Do MCP 서버 (읽기 + 태스크 추가만)
  openspec/           계획서, 스펙 (OpenSpec)
```

앞으로 `mcp/` 아래에 Gmail, GitHub, 폴리오 서버가, 별도 폴더에 에이전트가 들어옵니다. 에이전트는 각 MCP 서버의 도구만 알고, 서버끼리는 서로 모릅니다.

## 현재 상태

- `mcp/microsoft-todo`: 타입 검사, 린트, 빌드, 테스트 27개 통과. 아직 실제 Microsoft 계정으로 로그인해 본 적은 없습니다.
- 에이전트, 다른 MCP 서버, 브리핑 전송은 아직 없습니다.

## 출처 (Credits)

`mcp/microsoft-todo`는 **[fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)**(© 2026 Fabien Butz, MIT)를 바탕으로 필요한 부분만 골라 고친 것입니다. 기준 커밋, 원본 대비 변경, 라이선스는 [`mcp/microsoft-todo/README.md`](mcp/microsoft-todo/README.md), [`CHANGELOG.md`](mcp/microsoft-todo/CHANGELOG.md), [`LICENSE`](mcp/microsoft-todo/LICENSE)에 있습니다.

## 개발 규칙

- 작업은 OpenSpec으로 관리합니다. `/opsx:propose`로 계획서를 쓰고 **검토를 받은 뒤** 구현합니다.
- 에이전트에게 주는 도구는 **읽기와 추가**부터 시작하고, 수정·삭제 도구는 코드에 두지 않습니다.
- 비밀값(토큰, 키)은 저장소와 대화에 넣지 않습니다. `.env*`는 git이 무시합니다.
