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

## 하는 일

- To Do에서 오늘 마감, 임박, 밀린 일을 모아 먼저 할 일을 고릅니다.
- Gmail과 GitHub에서 할 일 후보를 찾고, 폴리오에 최근 동기화된 논문을 보여 줍니다.
- 태스크 추가를 켜면 중복과 실행당 상한을 확인한 뒤 To Do에 추가합니다. 날짜 근거가 없으면 마감을 비워 둡니다.
- 설정한 서비스·컨테이너·LLM 상태를 점검해 브리핑에 넣습니다.

기존 태스크 수정·삭제, 메일 발송, GitHub 변경은 하지 않습니다. 메일·이슈·태스크 내용은 외부 상용 LLM으로 보내지 않습니다.

## 시작하기

Node.js 20 이상이 필요합니다.

```bash
npm ci --ignore-scripts
npm run build
node app/dist/index.js --help
```

설정은 저장소 루트의 `.env.local`(권한 `600`)에 둡니다. 항목은 [앱 설정 안내](app/README.md)에 있고, 연결별 준비는 아래 문서를 따릅니다.

| 연결 | 용도 | 설정 |
| --- | --- | --- |
| Microsoft To Do | 할 일 조회·추가 | [README](sources/microsoft-todo/README.md) |
| Gmail | 메일 검색 | [README](sources/gmail/README.md) |
| GitHub | 리뷰 요청·배정·알림 조회 | [README](sources/github/README.md) |
| 폴리오 | 최근 논문 조회 | [README](sources/folio/README.md) |
| 카카오톡 | 브리핑 전송 | [README](sources/kakao/README.md) |
| 서버 점검 | 서비스·LLM 상태 | [README](sources/server/README.md) |

설정과 To Do 로그인을 마친 뒤 `node app/dist/index.js run --dry-run`으로 브리핑을 터미널에서 확인합니다. 드라이런도 소스를 읽고 모델을 호출합니다. 전송·태스크 추가·기록 저장만 하지 않습니다. **태스크 추가는 기본으로 꺼져 있으며** `ASSISTANT_CREATE_TASKS=1`로 켭니다.

## 개발

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

테스트는 모의 서비스를 씁니다. 개발 절차는 [AGENTS.md](AGENTS.md)에 있습니다.

## 라이선스

[MIT](LICENSE) © 2026 jwhitekim. `sources/microsoft-todo/`는 [fabienbutz/microsoft-todo-mcp](https://github.com/fabienbutz/microsoft-todo-mcp)(MIT)를 가져와 수정했으며 [원본 라이선스](sources/microsoft-todo/LICENSE)를 따릅니다.
