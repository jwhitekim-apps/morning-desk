// my-task original code (not derived from upstream).
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server";
import { createLogger } from "../src/logger";
import { defineTool } from "../src/tools/_shared";
import { VERSION } from "../src/version";
import pkg from "../package.json";

async function connect(tools: Parameters<typeof createServer>[1]) {
  const lines: string[] = [];
  const server = createServer({ logger: createLogger("debug", (l) => lines.push(l)), auth: { status: () => ({ restApiKey: false, clientSecret: false, refreshToken: "none" as const }) }, kakao: {} as never }, tools);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, lines };
}

const probe = defineTool({ name: "probe", description: "test only", risk: "auth", input: { n: z.number() }, handler: async (args) => ({ doubled: args.n * 2 }) });

describe("server skeleton", () => {
  it("starts with an empty tool list and identifies itself", async () => {
    const { client } = await connect([]);
    expect(client.getServerVersion()).toMatchObject({ name: "my-task-kakao-mcp", version: VERSION });
  });

  it("lists and runs a registered tool", async () => {
    const { client, lines } = await connect([probe]);
    expect((await client.listTools()).tools.map((t) => t.name)).toEqual(["probe"]);
    const res = await client.callTool({ name: "probe", arguments: { n: 21 } });
    expect(JSON.parse((res.content as { text: string }[])[0]!.text)).toEqual({ doubled: 42 });
    expect(lines.join("")).toContain('"tool":"probe"');
  });

  it("turns a thrown error into a coded error result without leaking its message", async () => {
    const boom = defineTool({ name: "boom", description: "test only", risk: "auth", input: {}, handler: async () => { throw new Error("본문: 비밀 메시지"); } });
    const { client, lines } = await connect([boom]);
    const res = await client.callTool({ name: "boom", arguments: {} });
    expect(res.isError).toBe(true);
    const text = (res.content as { text: string }[])[0]!.text;
    expect(JSON.parse(text).error.code).toBe("internal_error");
    expect(text + lines.join("")).not.toContain("비밀 메시지");
  });

  it("package.json and version.ts agree", () => {
    expect(pkg.version).toBe(VERSION);
  });
});
