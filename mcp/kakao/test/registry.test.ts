// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { allTools } from "../src/tools/registry";

// 이 서버는 나에게 보내기만 한다. 도구가 코드에 없으면 모델이 실수로도 부를 수 없다.
// 새 도구를 추가하려면 이 목록을 의도적으로 고쳐야 한다.
const ALLOWED = ["auth_status", "send_many_to_me", "send_to_me"];

describe("tool registry", () => {
  it("exposes exactly the allowed tool surface", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(ALLOWED);
  });

  it("has no read, friend or chat tools", () => {
    const forbidden = /read|get|list|search|fetch|friend|chat|history|inbox|receive/i;
    for (const tool of allTools) expect(tool.name, tool.name).not.toMatch(forbidden);
  });

  it("no tool input can name a recipient", () => {
    const recipientish = /receiver|recipient|uuid|friend|^to$|target|user_?id|phone|channel|chat/i;
    for (const tool of allTools) {
      for (const field of Object.keys(tool.inputShape)) expect(field, `${tool.name}.${field}`).not.toMatch(recipientish);
    }
  });

  it("the input shapes are exactly what we documented", () => {
    const shape = (name: string) => Object.keys(allTools.find((t) => t.name === name)!.inputShape).sort();
    expect(shape("send_to_me")).toEqual(["dryRun", "text"]);
    expect(shape("send_many_to_me")).toEqual(["dryRun", "messages"]);
    expect(shape("auth_status")).toEqual([]);
    expect(z.object(allTools.find((t) => t.name === "send_to_me")!.inputShape).safeParse({ text: "x", receiver_uuids: ["a"] }).success).toBe(true); // 모르는 필드는 무시될 뿐 어디에도 전달되지 않는다
  });

  it("every tool is send or auth risk (there is no read class at all)", () => {
    for (const tool of allTools) expect(["send", "auth"], tool.name).toContain(tool.risk);
  });

  it("has unique names and complete definitions", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of allTools) expect(tool.description.length).toBeGreaterThan(0);
  });
});

// 도구 목록 말고도, 코드 자체가 '나에게 보내기'뿐이라는 것을 구조로 확인한다.
describe("the code itself only talks to Kakao's token and send-to-me endpoints", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  const src = new URL("../src", import.meta.url).pathname;
  const text = sourceFiles(src).map((f) => readFileSync(f, "utf-8")).join("\n");

  it("every Kakao URL is the token endpoint or the memo (send-to-me) endpoint", () => {
    const urls = new Set(text.match(/https:\/\/k(?:api|auth)\.kakao\.com[^\s"'`)]*/g) ?? []);
    expect([...urls].sort()).toEqual(["https://kapi.kakao.com/v2/api/talk/memo/default/send", "https://kauth.kakao.com/oauth/token"]);
  });

  it("never references the friends or channel APIs", () => {
    expect(text).not.toMatch(/\/v1\/api\/talk\/friends|\/v2\/api\/talk\/friends|receiver_uuids|\/talk\/channels|\/talk\/profile/);
  });
});
