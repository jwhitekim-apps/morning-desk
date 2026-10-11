// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry";

// 이 서버는 GitHub를 읽기만 한다. 새 도구를 추가하려면 이 목록을 의도적으로 고쳐야 한다.
const ALLOWED = ["auth_status", "list_assigned_items", "list_notifications", "list_review_requests"];

describe("tool registry", () => {
  it("exposes exactly the allowed tool surface", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(ALLOWED);
  });

  it("has no tool whose name suggests writing or reading code", () => {
    const forbidden = /create|comment|merge|push|delete|remove|close|reopen|edit|update|assign_|label|review_submit|approve|mark|read_all|dismiss|fork|star|file|content|code|commit|clone/i;
    for (const tool of allTools) expect(tool.name, tool.name).not.toMatch(forbidden);
  });

  it("every tool is read or auth risk (there is no write class at all)", () => {
    for (const tool of allTools) expect(["read", "auth"], tool.name).toContain(tool.risk);
  });

  it("has unique names and complete definitions", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tool of allTools) expect(tool.description.length).toBeGreaterThan(0);
  });

  it("no tool takes a free-form search query, repository or owner (the model cannot widen what is read)", () => {
    for (const tool of allTools) {
      for (const field of Object.keys(tool.inputShape)) expect(field, `${tool.name}.${field}`).not.toMatch(/query|q$|repo|owner|org|user|login|url|path/i);
    }
  });
});

describe("the code itself only issues GET requests to a few read endpoints", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  const src = new URL("../src", import.meta.url).pathname;
  const files = sourceFiles(src).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, "utf-8") }));
  const all = files.map(({ text }) => text).join("\n");

  it("no source file names a request method other than GET", () => {
    for (const { f, text } of files) expect(text, f).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']|-X\s+(POST|PUT|PATCH|DELETE)/);
  });

  it("the only HTTP call is the one GET in github/client.ts", () => {
    const callers = files.filter(({ text }) => /fetchFn\(|fetch\(/.test(text)).map(({ f }) => f);
    expect(callers).toEqual(["github/client.ts"]);
    expect(files.find(({ f }) => f === "github/client.ts")!.text.match(/method: "GET"/g)).toHaveLength(1);
  });

  it("the endpoints used are exactly: user, search issues, notifications list, issue timeline", () => {
    const paths = new Set([...all.matchAll(/["'`](\/(?:user|search\/issues|notifications|repos\/\$\{repo\}\/issues\/\$\{number\}\/timeline))["'`]/g)].map((m) => m[1]));
    expect([...paths].sort()).toEqual(["/notifications", "/repos/${repo}/issues/${number}/timeline", "/search/issues", "/user"]);
    expect(all).not.toMatch(/\/notifications\/threads|\/contents\/|\/git\/|\/pulls\/\$|\/comments|\/merge|\/reviews/);
  });
});
