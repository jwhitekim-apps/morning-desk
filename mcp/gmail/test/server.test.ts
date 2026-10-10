// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { createServer } from "../src/server";
import { defineTool } from "../src/tools/_shared";
import { createLogger } from "../src/logger";
import { allTools } from "../src/tools/registry";
import { VERSION } from "../src/version";
import pkg from "../package.json";

async function connect(tools = allTools) {
  const lines: string[] = [];
  const auth = { status: () => ({ signedIn: false }), getAccessToken: async () => "unused" };
  const server = createServer({ logger: createLogger("debug", (l) => lines.push(l)), auth, gmail: {} as never }, tools);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, lines };
}

const probe = defineTool({ name: "probe", description: "test only", risk: "read", input: { n: z.number() }, handler: async (args) => ({ doubled: args.n * 2 }) });

describe("server skeleton", () => {
  it("starts with the registered tools and identifies itself", async () => {
    const { client } = await connect();
    expect(client.getServerVersion()).toMatchObject({ name: "my-task-gmail-mcp", version: VERSION });
  });

  it("lists and runs a registered tool, and logs only counts and timings", async () => {
    const { client, lines } = await connect([probe]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["probe"]);
    const res = await client.callTool({ name: "probe", arguments: { n: 21 } });
    expect(JSON.parse((res.content as { text: string }[])[0]!.text)).toEqual({ doubled: 42 });
    expect(lines.join("")).toContain('"tool":"probe"');
  });

  it("turns a thrown error into a coded error result without leaking its message", async () => {
    const boom = defineTool({ name: "boom", description: "test only", risk: "read", input: {}, handler: async () => { throw new Error("제목: 비밀 메일"); } });
    const { client, lines } = await connect([boom]);
    const res = await client.callTool({ name: "boom", arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text).error.code).toBe("internal_error");
    expect(text + lines.join("")).not.toContain("비밀 메일");
  });

  it("package.json and version.ts agree", () => {
    expect(pkg.version).toBe(VERSION);
  });
});
