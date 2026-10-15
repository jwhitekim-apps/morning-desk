// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@morning-desk/shared";
import { describe, expect, it } from "vitest";
import { createGmailSource, GMAIL_ALLOWED } from "../src/index";

// 위임 정책: 앱에는 읽기만 준다. 함수가 코드에 없으면 앱이 실수로도 부를 수 없다. 더하려면 이 목록과 명세를 의도적으로 고친다.
const ALLOWED = ["readEmail", "searchEmails"];

const source = createGmailSource({ logLevel: "silent", envFilePath: "/nonexistent/.env.local", clientId: undefined, clientSecret: undefined }, { logger: createLogger("silent") });

describe("the module surface", () => {
  it("exports exactly the allowed functions", () => {
    expect(Object.keys(source).sort()).toEqual(ALLOWED);
    expect([...GMAIL_ALLOWED].sort()).toEqual(ALLOWED);
  });

  it("has no function that sends, deletes or changes mail", () => {
    const forbidden = /send|reply|forward|draft|delete|remove|trash|spam|archive|modify|label|star|mark|move|create|update|insert|import|unsubscribe/i;
    for (const name of Object.keys(source)) expect(name).not.toMatch(forbidden);
  });

  it("does not start a browser sign-in when it is not signed in", async () => {
    const signedOut = createGmailSource({ logLevel: "silent", envFilePath: "/nonexistent/.env.local", clientId: "cid", clientSecret: "secret" }, { logger: createLogger("silent") });
    await expect(signedOut.searchEmails({ query: "x" })).rejects.toMatchObject({ code: "auth_required", message: expect.stringContaining("morning-desk login gmail") });
  });

  it("rejects an empty search query before calling Google", async () => {
    await expect(source.searchEmails({ query: "  " })).rejects.toMatchObject({ code: "validation_error" });
  });
});

// 함수 목록 말고도, 코드 자체가 읽기 전용이라는 것을 구조로 확인한다.
describe("the code itself is read-only", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  // 경로에 공백이 있어도 되도록 `pathname`(퍼센트 인코딩) 대신 파일 경로로 바꾼다.
  const src = fileURLToPath(new URL("../src", import.meta.url));
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
