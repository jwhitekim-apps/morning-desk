# Changelog

이 프로젝트의 변경 기록입니다. 원본(upstream)은 [fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)의 커밋 `83d8f44c6a74924acf2c7c5861d3c4d24e852d21`(v0.2.0)이고, 아래는 **원본 대비 바꾼 점**입니다.

## 0.0.1 (원본 v0.2.0 기준)

### 제거
- 도구: `update_task`, `complete_task`, `delete_task`, `create_task_list`, `update_task_list`, `delete_task_list`, 체크리스트 도구 4개(`src/tools/checklist-tools.ts` 삭제). 에이전트에게는 읽기와 태스크 추가만 줍니다.
- 원본의 운영 파일: `.github/`(CI, Dependabot), `CONTRIBUTING.md`, `SECURITY.md`, 원본 `CHANGELOG.md`, 원본 `README.md`, `docs/INSTALL-WINDOWS.md`.

### 변경
- `test/registry.test.ts`: 도구 개수 검사 대신 **허용 목록과 정확히 같은지**, 위험(destructive) 도구가 없는지, 수정·삭제 도구 이름이 없는지를 검사합니다.
- `package.json`: 이름을 `my-task-todo-mcp`로, 버전 `0.0.1`, `private: true`, 원본의 `homepage`, `bugs`, `repository`, `keywords` 제거, `bin` 이름 변경.
- `src/version.ts`: 버전 문자열을 `0.0.1`로(`package.json`과 같아야 한다는 원본 테스트 때문).
- 가져온 소스와 테스트 파일 상단에 출처 주석을 추가했고, 수정한 파일에는 수정 내용을 적었습니다.
- 원본의 `docs/ARCHITECTURE.md`, `docs/ENTRA-APP-SETUP.md`는 `docs/upstream/`로 옮기고 출처 안내를 맨 위에 붙였습니다.

### 그대로 둔 것
- 인증(기기 코드, MSAL 토큰 캐시), Graph 클라이언트, 페이지 넘김, 멱등성 처리, 로거, 서버 조립, 설정 환경 변수.
