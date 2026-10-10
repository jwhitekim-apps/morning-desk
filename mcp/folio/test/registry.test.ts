// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry";

// 이 서버는 폴리오를 읽기만 한다. 새 도구를 추가하려면 이 목록을 의도적으로 고쳐야 한다.
const ALLOWED = ["list_recent_papers", "search_papers"];

describe("tool registry", () => {
  it("exposes exactly the allowed tool surface", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(ALLOWED);
  });

  it("has no tool whose name suggests writing", () => {
    const forbidden = /create|insert|add|update|upsert|delete|remove|write|set|sync|import|save|edit|patch/i;
    for (const tool of allTools) expect(tool.name, tool.name).not.toMatch(forbidden);
  });

  it("every tool is read risk (there is no write class at all)", () => {
    for (const tool of allTools) expect(tool.risk, tool.name).toBe("read");
  });

  it("has unique names and complete definitions", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of allTools) expect(tool.description.length).toBeGreaterThan(0);
  });
});

describe("the code itself only issues GET requests", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  const src = new URL("../src", import.meta.url).pathname;
  const files = sourceFiles(src).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, "utf-8") }));

  it("no source file names a request method other than GET", () => {
    for (const { f, text } of files) expect(text, f).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']|Prefer:\s*return=|\.rpc\(|\/rest\/v1\/rpc\//);
  });

  it("the only HTTP call is the one GET in folio/api.ts", () => {
    const callers = files.filter(({ text }) => /fetchFn\(|fetch\(/.test(text)).map(({ f }) => f);
    expect(callers).toEqual(["folio/api.ts"]);
    expect(files.find(({ f }) => f === "folio/api.ts")!.text.match(/method: "GET"/g)).toHaveLength(1);
  });
});
