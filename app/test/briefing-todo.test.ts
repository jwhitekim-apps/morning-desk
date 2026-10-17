// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { buildDeterministicBriefing, MAX_BUBBLES } from "../src/briefing/deterministic";
import { describeFailure } from "../src/briefing/failures";
import { collectTodo, kstToday } from "../src/briefing/todo";
import { SourceError } from "@morning-desk/shared";
import { AppError } from "../src/errors";
import { fakeModules } from "./fakes";

const NOW = new Date("2026-10-11T22:00:00Z"); // 한국 시간 10/12 07:00 월요일

const due = (title: string, dueDate: string, extra: Record<string, unknown> = {}) => ({ id: title, title, dueDate, listName: "작업", ...extra });

/** To Do 모듈을 흉내 낸다. 부른 함수를 기록한다. */
function fakeCaller(answer: unknown | Error) {
  const { modules, calls } = fakeModules(() => answer);
  return { caller: modules.todo, calls };
}

describe("kstToday", () => {
  it("is the Korea date, not the UTC date", () => {
    expect(kstToday(NOW)).toBe("2026-10-12");
    expect(kstToday(new Date("2026-10-12T14:59:59Z"))).toBe("2026-10-12");
    expect(kstToday(new Date("2026-10-12T15:00:00Z"))).toBe("2026-10-13");
  });
});

describe("collectTodo", () => {
  it("asks To Do for today through seven days ahead, including overdue", async () => {
    const { caller, calls } = fakeCaller({ items: [] });
    await collectTodo(caller, NOW);
    expect(calls).toEqual([{ server: "todo", tool: "listTasksDue", args: { from: "2026-10-12", to: "2026-10-19", includeOverdue: true, maxResults: 200 } }]);
  });

  it("sorts tasks into today, upcoming and overdue with day counts", async () => {
    const { caller } = fakeCaller({
      items: [
        due("밀린 일", "2026-10-05"),
        due("오늘 일", "2026-10-12", { body: { content: "15:00 랩미팅" } }),
        due("곧 올 일", "2026-10-14"),
        due("더 곧 올 일", "2026-10-13"),
      ],
    });
    const t = await collectTodo(caller, NOW);
    expect(t.tasksToday).toEqual([{ name: "오늘 일", memo: "15:00 랩미팅" }]);
    expect(t.overdue).toEqual([{ name: "밀린 일", deadline: "2026-10-05", days: 7 }]);
    expect(t.upcoming).toEqual([{ name: "더 곧 올 일", deadline: "2026-10-13", daysLeft: 1 }, { name: "곧 올 일", deadline: "2026-10-14", daysLeft: 2 }]);
    expect(t.existing).toHaveLength(4);
    expect(t.existing[0]).toEqual({ name: "밀린 일", deadline: "2026-10-05" });
  });

  it("turns truncation, unreadable lists and unconvertible tasks into notes and failures", async () => {
    const { caller } = fakeCaller({ items: [], truncated: true, omitted: 12, failedLists: [{ listName: "개인" }], unconvertible: 2 });
    const t = await collectTodo(caller, NOW);
    expect(t.notes).toEqual(["마감 일정이 많아 일부만 표시했어요(12건 더 있음).", "시간대를 읽지 못한 태스크 2건은 빠졌어요."]);
    expect(t.failures).toEqual(["To Do 목록 '개인' 읽지 못함"]);
  });
});

describe("the model-free briefing", () => {
  const ANSWER = {
    items: [
      due("원서 제출", "2026-10-01"),
      due("랩미팅", "2026-10-12", { body: { content: "15:00" } }),
      due("논문 송금", "2026-10-15"),
    ],
  };

  it("puts the first things on top (overdue, today, upcoming) and lists today in full, with the right content", async () => {
    const { caller } = fakeCaller(ANSWER);
    const { messages } = await buildDeterministicBriefing(caller, NOW);
    const text = messages.join("\n");
    expect(text.split("\n")[0]).toBe("10/12(월) 브리핑");
    expect(text).toContain("[먼저 할 일]\n1) 원서 제출 — 11일 밀림\n2) 랩미팅 — 오늘 마감\n3) 논문 송금 — 3일 남음");
    expect(text).toContain("[오늘]\n· 랩미팅 15:00");
    expect(text).not.toContain("[밀린 일]"); // 먼저 할 일에 올린 것은 되풀이하지 않는다
    expect(text.indexOf("[먼저 할 일]")).toBeLessThan(text.indexOf("[오늘]"));
  });

  it("overdue and upcoming items that are not in the first three keep their own sections", async () => {
    // 밀린 일 4개: 오래된 순서로 셋이 먼저 할 일에 올라가고 하나가 밀린 일에 남는다.
    const more = { items: [...ANSWER.items, due("오래된 일", "2026-09-01"), due("또 밀린 일", "2026-10-02"), due("세 번째 일", "2026-10-03"), due("다음 주 일", "2026-10-18")] };
    const text = (await buildDeterministicBriefing(fakeCaller(more).caller, NOW)).messages.join("\n");
    expect(text).toContain("[먼저 할 일]\n1) 오래된 일 — 41일 밀림\n2) 원서 제출 — 11일 밀림\n3) 또 밀린 일 — 10일 밀림");
    expect(text).toContain("[밀린 일]\n· 세 번째 일(10/3, 9일째)");
    expect(text).toContain("[임박]\n· 논문 송금(10/15·3일 후)\n· 다음 주 일(10/18·6일 후)");
  });

  it("makes no model call: it only ever calls the To Do module's listTasksDue", async () => {
    const { caller, calls } = fakeCaller(ANSWER);
    await buildDeterministicBriefing(caller, NOW);
    expect(calls.map((c) => `${c.server}.${c.tool}`)).toEqual(["todo.listTasksDue"]);
  });

  it("every bubble fits the Kakao limit and there are at most MAX_BUBBLES", async () => {
    const many = { items: Array.from({ length: 90 }, (_, i) => due(`아주 긴 이름의 오늘 마감 일정 번호 ${i}`, "2026-10-12")) };
    const { messages } = await buildDeterministicBriefing(fakeCaller(many).caller, NOW);
    expect(messages.length).toBeLessThanOrEqual(MAX_BUBBLES);
    expect(messages.every((m) => m.length <= 200)).toBe(true);
    expect(messages[messages.length - 1]).toMatch(/…외 \d+건 생략$/);
  });

  it("a quiet day says so", async () => {
    const { messages } = await buildDeterministicBriefing(fakeCaller({ items: [] }).caller, NOW);
    expect(messages.join("\n")).toContain("오늘 일정 없음");
  });

  it("when To Do cannot be read, a failure notice is built instead of a briefing", async () => {
    const err = new SourceError("auth_expired", "x");
    const { messages, input } = await buildDeterministicBriefing(fakeCaller(err).caller, NOW);
    expect(input.failures).toEqual(["To Do 로그인 만료"]);
    expect(messages.join("\n")).toContain("[⚠ 실패]\n· To Do 로그인 만료");
    expect(messages.join("\n")).not.toContain("[오늘]");
  });

  it("an unreadable list becomes a failure line while the rest of the briefing still comes out", async () => {
    const { messages } = await buildDeterministicBriefing(fakeCaller({ items: [due("랩미팅", "2026-10-12")], failedLists: [{ listName: "개인" }] }).caller, NOW);
    const text = messages.join("\n");
    expect(text).toContain("[⚠ 실패]\n· To Do 목록 '개인' 읽지 못함");
    expect(text).toContain("랩미팅");
  });

  it("when the model failed, the briefing says it was made without the model and lists the cause", async () => {
    const { messages } = await buildDeterministicBriefing(fakeCaller(ANSWER).caller, NOW, { modelFailure: "모델 시간 초과" });
    const text = messages.join("\n");
    expect(text).toContain("[⚠ 실패]\n· 모델 시간 초과");
    expect(text).toContain("모델 없이 만든 기본 브리핑이에요.");
  });
});

describe("describeFailure", () => {
  it("names the source and a short reason from the module's error code, never the module's own text", () => {
    expect(describeFailure("Gmail", new SourceError("auth_expired", "gmail.search failed: 극비 문장"))).toBe("Gmail 로그인 만료");
    expect(describeFailure("GitHub", new SourceError("rate_limited", "x"))).toBe("GitHub 요청 한도 초과");
    expect(describeFailure("To Do", new SourceError("graph_unavailable", "x"))).toBe("To Do 서버 일시 장애");
    expect(describeFailure("폴리오", new AppError("timeout", "x"))).toBe("폴리오 시간 초과");
    expect(describeFailure("모델", new Error("secret 극비"))).toBe("모델 오류");
    expect(describeFailure("Gmail", new SourceError("something_new", "x"))).toBe("Gmail 오류");
    expect(describeFailure("Gmail", new SourceError("auth_expired", "극비 문장"))).not.toContain("극비");
  });
});
