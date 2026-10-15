// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@morning-desk/shared";
import { describe, expect, it } from "vitest";
import { createKakaoSource, KAKAO_ALLOWED } from "../src/index";

// 이 모듈은 나에게 보내기만 한다. 함수가 코드에 없으면 앱이 실수로도 부를 수 없다. 더하려면 이 목록과 명세를 의도적으로 고친다.
const ALLOWED = ["sendManyToMe"];

const source = createKakaoSource(
  { logLevel: "silent", envFilePath: "/nonexistent/.env.local", restApiKey: undefined, clientSecret: undefined, linkUrl: undefined, dryRunAll: true },
  { logger: createLogger("silent") },
);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
// 경로에 공백이 있어도 되도록 `pathname`(퍼센트 인코딩) 대신 파일 경로로 바꾼다.
const src = fileURLToPath(new URL("../src", import.meta.url));
const files = sourceFiles(src).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, "utf-8") }));
const text = files.map((x) => x.text).join("\n");

describe("the module surface", () => {
  it("exports exactly the allowed functions", () => {
    expect(Object.keys(source).sort()).toEqual(ALLOWED);
    expect([...KAKAO_ALLOWED].sort()).toEqual(ALLOWED);
  });

  it("has no read, friend or chat functions", () => {
    const forbidden = /read|get|list|search|fetch|friend|chat|history|inbox|receive/i;
    for (const name of Object.keys(source)) expect(name).not.toMatch(forbidden);
  });

  it("the send function cannot name a recipient: its only inputs are the messages and dryRun", () => {
    const iface = /export interface KakaoSource \{([\s\S]*?)\n\}/.exec(files.find(({ f }) => f === "index.ts")!.text)![1]!;
    const signature = /sendManyToMe\(([^)]*)\)/.exec(iface)![1]!;
    expect(signature).toBe("messages: readonly string[], opts?: { dryRun?: boolean }");
    expect(signature).not.toMatch(/receiver|recipient|uuid|friend|target|user_?id|phone|channel|chat/i);
  });
});

// 함수 목록 말고도, 코드 자체가 '나에게 보내기'뿐이라는 것을 구조로 확인한다.
describe("the code itself only talks to Kakao's token and send-to-me endpoints", () => {
  it("every Kakao URL is the token endpoint or the memo (send-to-me) endpoint", () => {
    const urls = new Set(text.match(/https:\/\/k(?:api|auth)\.kakao\.com[^\s"'`)]*/g) ?? []);
    expect([...urls].sort()).toEqual(["https://kapi.kakao.com/v2/api/talk/memo/default/send", "https://kauth.kakao.com/oauth/token"]);
  });

  it("never references the friends or channel APIs", () => {
    expect(text).not.toMatch(/\/v1\/api\/talk\/friends|\/v2\/api\/talk\/friends|receiver_uuids|\/talk\/channels|\/talk\/profile/);
  });
});
