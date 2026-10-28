# morning-desk

Microsoft To Do의 할 일과 Gmail·GitHub·폴리오 정보를 모아, 하루 한 번 카카오톡 "나에게 보내기"로 브리핑을 보내는 개인 비서입니다. 할 일은 To Do에 입력하고, 앱은 집 서버의 크론으로 실행되며 로컬 LLM으로 새 할 일 후보를 찾습니다.

```text
10/12(월) 브리핑

[먼저 할 일]
1) 원서 제출 — 11일 밀림
2) 장비 반납 — 3일 밀림
3) 랩미팅 — 오늘 마감

[오늘]
· 랩미팅 15:00

[임박]
· 논문 송금(10/15·3일 후)
· 세미나 발표 자료(10/18·6일 후)
```

<sub>예시 To Do 항목 5개를 넣어 모델 없이 만드는 기본 브리핑(`buildDeterministicBriefing`)을 실행한 결과입니다. 실제 실행에서는 수집한 메일·GitHub·논문의 건수와 제목도 나오고, 모델 분석이 성공하면 새 할 일 후보가 더해집니다.</sub>

## 시작하기

Node.js 20 이상이 필요합니다. 저장소 루트에서 설치·빌드한 뒤 CLI 도움말을 확인합니다. 이 단계에는 외부 계정이나 환경 설정이 필요하지 않습니다.

```bash
npm ci --ignore-scripts
npm run build
node app/dist/index.js --help
```

사용 가능한 명령 목록이 표시됩니다. 브리핑 실행과 연결 설정은 [앱 사용 안내](app/README.md)를 따릅니다.

## 관련 문서

- [앱 명령·환경 설정](app/README.md)
- 연결별 준비: [Microsoft To Do](sources/microsoft-todo/README.md), [Gmail](sources/gmail/README.md), [GitHub](sources/github/README.md), [폴리오](sources/folio/README.md), [카카오톡](sources/kakao/README.md)
- [서버·LLM 상태 점검 설정](sources/server/README.md)
- [개발 절차와 프로젝트 규칙](AGENTS.md)

## 라이선스

[MIT](LICENSE) © 2026 jwhitekim. `sources/microsoft-todo/`는 [fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)(MIT)를 가져와 수정했으며 [원본 라이선스](sources/microsoft-todo/LICENSE)를 따릅니다.
