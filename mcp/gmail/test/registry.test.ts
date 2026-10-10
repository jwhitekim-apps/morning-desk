// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry";

// 이 서버는 메일을 읽기만 한다. 도구가 코드에 없으면 모델이 실수로도 부를 수 없다.
// 새 도구를 추가하려면 이 목록을 의도적으로 고쳐야 한다.
const ALLOWED = ["auth_status", "read_email", "search_emails"];

describe("tool registry", () => {
  it("exposes exactly the allowed tool surface", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(ALLOWED);
  });

  it("has no tool whose name suggests changing the mailbox", () => {
    const forbidden = /send|reply|forward|draft|delete|remove|trash|spam|archive|modify|label|star|mark|move|create|update|insert|import|unsubscribe/i;
    for (const tool of allTools) expect(tool.name, tool.name).not.toMatch(forbidden);
  });

  it("every tool is read or auth risk (there is no write class at all)", () => {
    for (const tool of allTools) expect(["read", "auth"], tool.name).toContain(tool.risk);
  });

  it("has unique names and complete definitions", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(typeof tool.inputShape).toBe("object");
    }
  });
});

// 도구 목록 말고도, 코드 자체가 읽기 전용이라는 것을 구조로 확인한다.
describe("the code itself is read-only", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  const src = new URL("../src", import.meta.url).pathname;
  const files = sourceFiles(src).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, "utf-8") }));

  it("requests exactly one Google scope: gmail.readonly", () => {
    const scopes = new Set(files.flatMap(({ text }) => text.match(/https:\/\/(?:www\.googleapis\.com\/auth\/|mail\.google\.com)[^\s"'`)]*/g) ?? []));
    expect([...scopes]).toEqual(["https://www.googleapis.com/auth/gmail.readonly"]);
  });

  it("the Gmail client only ever issues GET requests", () => {
    const gmailFiles = files.filter(({ f }) => f.startsWith("gmail/"));
    expect(gmailFiles.length).toBeGreaterThan(0);
    for (const { f, text } of gmailFiles) expect(text, f).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']|\/(send|trash|untrash|modify|batchModify|batchDelete|drafts)\b/);
  });
});
