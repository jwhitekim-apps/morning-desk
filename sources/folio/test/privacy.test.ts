// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { createLogger } from "@morning-desk/shared";
import { toAppError } from "../src/errors";
import type { FetchFn } from "../src/folio/api";
import { createFolioSource } from "../src/index";

const KEY = "SUPABASE-SERVICE-KEY-SECRET-0001";
const PROJECT = "secretproject";
const TITLE = "극비 연구 논문 제목 91ab";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

function world(mode: "ok" | "bad-key" | "no-table" | "down" | "echo-error") {
  const methods: string[] = [];
  const fetchFn: FetchFn = (async (_input: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    if (mode === "bad-key") return json({ message: `Invalid API key ${KEY}` }, 401);
    if (mode === "no-table") return json({ code: "PGRST205", message: `table ${TITLE}` }, 404);
    if (mode === "down") return json({}, 503);
    if (mode === "echo-error") return json({ message: `${KEY} ${TITLE}` }, 400);
    return json([{ item_key: "K1", title: TITLE, year: 2024, synced_at: "2026-10-09T00:00:00Z" }]);
  }) as FetchFn;
  const lines: string[] = [];
  const logger = createLogger("debug", (l) => lines.push(l));
  const folio = createFolioSource({ logLevel: "debug", url: `https://${PROJECT}.supabase.co`, key: KEY, table: "folio_papers" }, { logger, fetchFn, sleep: async () => undefined });
  return { folio, lines, methods };
}

/** 모든 함수를 한 번씩 부르고, 앱이 받는 결과(또는 오류)를 글자로 모은다. */
async function runAllTools(mode: Parameters<typeof world>[0]) {
  const { folio, lines, methods } = world(mode);
  const out: string[] = [];
  const call = async (fn: () => Promise<unknown>) => {
    try {
      out.push(JSON.stringify(await fn()));
    } catch (err) {
      const e = toAppError(err);
      out.push(JSON.stringify({ error: e.toJSON() }) + e.message);
    }
  };
  await call(() => folio.listRecentPapers({ since: "2026-10-01", maxResults: 10 }));
  await call(() => folio.searchPapers({ query: "극비" }));
  return { responses: out, logs: lines.join(""), methods };
}

const MODES = ["ok", "bad-key", "no-table", "down", "echo-error"] as const;

describe("the key stays out of logs and responses", () => {
  for (const mode of MODES) {
    it(`no key in logs or responses (${mode})`, async () => {
      const { logs, responses } = await runAllTools(mode);
      expect(logs.length).toBeGreaterThan(0); // 로그가 아예 없어서 통과하는 일을 막는다
      expect(logs, "key in logs").not.toContain(KEY);
      expect(logs, "bearer in logs").not.toContain("Bearer");
      expect(responses.join("\n"), "key in responses").not.toContain(KEY);
    });
  }

  it("logs hold counts and timings, never paper titles", async () => {
    for (const mode of MODES) expect((await runAllTools(mode)).logs, mode).not.toContain("극비");
    expect((await runAllTools("ok")).logs).toMatch(/"count":1/);
  });

  it("error responses do not echo the database's text, and the project address is never printed", async () => {
    for (const mode of ["bad-key", "no-table", "down", "echo-error"] as const) {
      const { responses, logs } = await runAllTools(mode);
      expect(responses.join("\n"), mode).not.toContain(TITLE);
      expect(responses.join("\n") + logs, mode).not.toContain(PROJECT);
    }
  });

  it("only the successful read returns titles, which is its purpose", async () => {
    expect((await runAllTools("ok")).responses.join("\n")).toContain(TITLE);
  });
});

describe("every request that goes out is a GET", () => {
  for (const mode of MODES) {
    it(`only GET (${mode})`, async () => {
      const { methods } = await runAllTools(mode);
      expect(methods.length).toBeGreaterThan(0);
      expect(new Set(methods)).toEqual(new Set(["GET"]));
    });
  }
});
