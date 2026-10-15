// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@morning-desk/shared";
import { describe, expect, it } from "vitest";
import { createGithubSource, GITHUB_ALLOWED } from "../src/index";

// 위임 정책: 앱에는 읽기만 준다. 함수가 코드에 없으면 앱이 실수로도 부를 수 없다. 더하려면 이 목록과 명세를 의도적으로 고친다.
const ALLOWED = ["listAssignedItems", "listNotifications", "listReviewRequests"];

const source = createGithubSource({ logLevel: "silent", token: undefined, notificationsToken: undefined, repos: [] }, { logger: createLogger("silent") });

describe("the module surface", () => {
  it("exports exactly the allowed functions", () => {
    expect(Object.keys(source).sort()).toEqual(ALLOWED);
    expect([...GITHUB_ALLOWED].sort()).toEqual(ALLOWED);
  });

  it("has no function whose name suggests writing or reading code", () => {
    // 이름을 낱말(camelCase)로 나눠 본다. 그래야 `listAssignedItems`(배정된 항목 읽기)가 `assign`·`edit`에 잘못 걸리지 않는다.
    const forbidden = new Set(["create", "comment", "merge", "push", "delete", "remove", "close", "reopen", "edit", "update", "assign", "label", "submit", "approve", "mark", "dismiss", "fork", "star", "file", "content", "code", "commit", "clone"]);
    for (const name of Object.keys(source)) {
      const words = name.split(/(?=[A-Z])/).map((w) => w.toLowerCase());
      expect(words.filter((w) => forbidden.has(w)), name).toEqual([]);
    }
  });
});

describe("the code itself only issues GET requests to a few read endpoints", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  // 경로에 공백이 있어도 되도록 `pathname`(퍼센트 인코딩) 대신 파일 경로로 바꾼다.
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const files = sourceFiles(src).map((f) => ({ f: f.slice(src.length + 1), text: readFileSync(f, "utf-8") }));
  const all = files.map(({ text }) => text).join("\n");

  it("no function takes a free-form search query, repository or owner (callers cannot widen what is read)", () => {
    const iface = /export interface GithubSource \{([\s\S]*?)\n\}/.exec(files.find(({ f }) => f === "index.ts")!.text)![1]!;
    const inputs = [...iface.matchAll(/\((?:input\??: )?\{([^}]*)\}\)/g)].map((m) => m[1]!.trim());
    expect(inputs).toEqual(["maxResults?: number", "maxResults?: number", "maxResults?: number"]);
  });

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
