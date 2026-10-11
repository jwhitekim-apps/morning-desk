// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/registry";

// 이 서버는 벨루를 읽기만 한다. 새 도구를 추가하려면 이 목록을 의도적으로 고쳐야 한다.
const ALLOWED = ["veloo_auth_status", "veloo_list_tasks", "veloo_weekly_review"];

describe("tool registry", () => {
  it("exposes exactly the allowed tool surface", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual(ALLOWED);
  });

  it("has no tool whose name suggests writing", () => {
    const forbidden = /create|add|update|delete|remove|complete|done|finish|edit|patch|write|save|set_|move|import|reorder/i;
    for (const tool of allTools) expect(tool.name.replace(/^veloo_/, ""), tool.name).not.toMatch(forbidden);
  });

  it("every tool is read or auth risk (there is no write class at all)", () => {
    for (const tool of allTools) expect(["read", "auth"], tool.name).toContain(tool.risk);
  });

  it("has unique names, prefixed so they cannot be confused with the To Do tools", () => {
    const names = allTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.startsWith("veloo_"), n).toBe(true);
    for (const tool of allTools) expect(tool.description.length).toBeGreaterThan(0);
  });
});

describe("the code itself can only read", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  const src = new URL("../src", import.meta.url).pathname;
  const files = sourceFiles(src).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, "utf-8") }));
  const all = files.map(({ text }) => text).join("\n");

  it("the only non-GET request is the login", () => {
    const methods = [...all.matchAll(/method:\s*["']([A-Z]+)["']/g)].map((m) => m[1]);
    expect(methods.sort()).toEqual(["GET", "POST"]);
    const client = files.find(({ f }) => f === "veloo/client.ts")!.text;
    const post = client.indexOf('method: "POST"');
    expect(client.slice(Math.max(0, post - 200), post)).toContain("/login");
  });

  it("the only HTTP calls are in veloo/client.ts", () => {
    expect(files.filter(({ text }) => /fetchFn\(|fetch\(/.test(text)).map(({ f }) => f)).toEqual(["veloo/client.ts"]);
  });

  it("the endpoints used are exactly: login, task list, weekly review", () => {
    const paths = new Set([...all.matchAll(/[}"'`](\/(?:login|todo\/api\/[a-z/]+))[?"'`]/g)].map((m) => m[1]));
    expect([...paths].sort()).toEqual(["/login", "/todo/api/reviews/weekly", "/todo/api/todos"]);
    expect(all).not.toMatch(/\/steps|\/done|\/ai\/|PATCH|DELETE|PUT/);
  });
});
