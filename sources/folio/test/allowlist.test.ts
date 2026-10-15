// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@morning-desk/shared";
import { describe, expect, it } from "vitest";
import { createFolioSource, FOLIO_ALLOWED } from "../src/index";

// 위임 정책: 앱에는 읽기만 준다. 함수가 코드에 없으면 앱이 실수로도 부를 수 없다. 더하려면 이 목록과 명세를 의도적으로 고친다.
const ALLOWED = ["listRecentPapers", "searchPapers"];

const source = createFolioSource({ logLevel: "silent", url: undefined, key: undefined, table: "folio_papers" }, { logger: createLogger("silent") });

describe("the module surface", () => {
  it("exports exactly the allowed functions", () => {
    expect(Object.keys(source).sort()).toEqual(ALLOWED);
    expect([...FOLIO_ALLOWED].sort()).toEqual(ALLOWED);
  });

  it("has no write-like function", () => {
    const forbidden = /create|insert|add|update|upsert|delete|remove|write|set|sync|import|save|edit|patch/i;
    for (const name of Object.keys(source)) expect(name).not.toMatch(forbidden);
  });
});

describe("the code itself only issues GET requests", () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
  // 경로에 공백이 있어도 되도록 `pathname`(퍼센트 인코딩) 대신 파일 경로로 바꾼다.
  const src = fileURLToPath(new URL("../src", import.meta.url));
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
