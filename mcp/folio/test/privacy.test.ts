// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FolioApi, type FetchFn } from "../src/folio/api";
import { createLogger } from "../src/logger";
import { createServer } from "../src/server";

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
  const folio = new FolioApi(logger, { url: `https://${PROJECT}.supabase.co`, key: KEY, table: "folio_papers", fetchFn, sleep: async () => undefined });
  return { ctx: { logger, folio }, lines, methods };
}

async function runAllTools(mode: Parameters<typeof world>[0]) {
  const { ctx, lines, methods } = world(mode);
  const server = createServer(ctx);
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(s), client.connect(c)]);
  const out: string[] = [];
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    out.push((res.content as { text: string }[]).map((p) => p.text).join(""));
  };
  await call("list_recent_papers", { since: "2026-10-01", maxResults: 10 });
  await call("search_papers", { query: "극비" });
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
