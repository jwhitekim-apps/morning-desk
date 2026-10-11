// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { compose } from "../src/briefing/deterministic";
import type { TodoSlice } from "../src/briefing/todo";
import { pickTop } from "../src/briefing/top";

const slice = (over: Partial<TodoSlice> = {}): TodoSlice => ({ tasksToday: [], upcoming: [], overdue: [], notes: [], failures: [], existing: [], ...over });

describe("pickTop", () => {
  it("takes overdue (longest first), then today, then upcoming (soonest first), at most three", () => {
    const top = pickTop(slice({
      overdue: [{ name: "조금 밀림", deadline: "2026-10-10", days: 2 }, { name: "많이 밀림", deadline: "2026-09-01", days: 41 }],
      tasksToday: [{ name: "오늘", memo: "" }],
      upcoming: [{ name: "곧", deadline: "2026-10-13", daysLeft: 1 }],
    }));
    expect(top).toEqual([{ name: "많이 밀림", reason: "41일 밀림" }, { name: "조금 밀림", reason: "2일 밀림" }, { name: "오늘", reason: "오늘 마감" }]);
  });

  it("is empty on a quiet day", () => {
    expect(pickTop(slice())).toEqual([]);
  });
});

describe("the first-things section in the briefing", () => {
  it("comes before today and is not repeated in overdue or upcoming, while today's list stays complete", () => {
    const { messages } = compose({
      now: new Date("2026-10-11T22:00:00Z"),
      todo: slice({ overdue: [{ name: "원서", deadline: "2026-10-01", days: 11 }], tasksToday: [{ name: "랩미팅", memo: "" }], upcoming: [{ name: "송금", deadline: "2026-10-14", daysLeft: 2 }, { name: "보고서", deadline: "2026-10-18", daysLeft: 6 }] }),
    });
    const text = messages.join("\n");
    expect(text).toContain("[먼저 할 일]\n1) 원서 — 11일 밀림\n2) 랩미팅 — 오늘 마감\n3) 송금 — 2일 남음");
    expect(text).toContain("[오늘]\n· 랩미팅");
    expect(text).not.toContain("[밀린 일]");
    expect(text).toContain("[임박]\n· 보고서(10/18·6일 후)");
    expect(text.indexOf("[먼저 할 일]")).toBeLessThan(text.indexOf("[오늘]"));
  });
});
