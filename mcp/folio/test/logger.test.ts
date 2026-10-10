// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { createLogger, type LogFields } from "../src/logger";

function collect(level = "debug") {
  const lines: string[] = [];
  return { lines, log: createLogger(level, (l) => lines.push(l)) };
}

describe("logger keeps only allow-listed fields", () => {
  it("drops fields that are not on the allow-list, whatever their value", () => {
    const { log, lines } = collect();
    // 일부러 타입 검사를 우회해서, 실수로 내용이 넘어와도 기록되지 않는지 본다.
    log.info("papers read", { count: 3, text: "비밀 제목", body: "본문", access_token: "ya29.secret", refresh_token: "1//secret" } as LogFields);
    const out = lines.join("");
    expect(out).toContain('"count":3');
    for (const leaked of ["비밀 제목", "본문", "ya29.secret", "1//secret", "text", "access_token"]) expect(out).not.toContain(leaked);
  });

  it("drops long strings even in allowed fields", () => {
    const { log, lines } = collect();
    log.info("x", { tool: "a".repeat(200) });
    expect(lines.join("")).not.toContain("aaaa");
  });

  it("respects the level", () => {
    const { log, lines } = collect("error");
    log.info("quiet");
    log.error("loud", { errorCode: "auth_expired" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("auth_expired");
  });

  it("child loggers add their fields", () => {
    const { log, lines } = collect();
    log.child({ tool: "list_recent_papers" }).info("ok", { durationMs: 5 });
    expect(lines[0]).toContain('"tool":"list_recent_papers"');
  });
});
