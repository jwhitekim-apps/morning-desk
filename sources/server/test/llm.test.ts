// my-task original code (not derived from upstream).
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkLlm } from "../src/checks/llm";
import { parseTargets } from "../src/config";

const KEY = "llm-key-SECRET-0001";
let server: Server;
let port: number;
let closedPort: number;
let requests: { method: string; url: string; auth: string | undefined }[] = [];
let models = ["qwen3.6:35b-a3b", "bge-m3:latest"];

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res) => {
    requests.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization });
    if (req.url === "/v1/models") {
      if (req.headers.authorization !== `Bearer ${KEY}`) return void res.writeHead(401).end(JSON.stringify({ error: "bad key" }));
      return void res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: models.map((id) => ({ id, object: "model" })) }));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
  const tmp = createTcpServer();
  await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
  closedPort = (tmp.address() as AddressInfo).port;
  await new Promise<void>((r) => tmp.close(() => r()));
});
afterAll(() => server.close());
beforeEach(() => {
  requests = [];
  models = ["qwen3.6:35b-a3b", "bge-m3:latest"];
});

const target = (p = port, expected = ["qwen3.6:35b-a3b"]) =>
  parseTargets({ llm: { name: "school-llm", baseUrl: `http://127.0.0.1:${p}/v1`, models: expected, timeoutMs: 1000 } }).llm!;

describe("LLM check", () => {
  it("all steps ok, and only GET /v1/models was requested", async () => {
    const r = await checkLlm(target(), KEY);
    expect(r).toMatchObject({ name: "school-llm", status: "ok", steps: { port: "ok", api: "ok", auth: "ok", models: "ok" }, plaintext: true });
    expect(r.failedAt).toBeUndefined();
    expect(requests).toEqual([{ method: "GET", url: "/v1/models", auth: `Bearer ${KEY}` }]);
  });

  it("closed port: down at the port step, later steps not checked", async () => {
    const r = await checkLlm(target(closedPort), KEY);
    expect(r).toMatchObject({ status: "down", failedAt: "port", reason: "refused", steps: { port: "failed", api: "skipped", auth: "skipped", models: "skipped" } });
    expect(requests).toHaveLength(0);
  });

  it("rejected key: an auth-step failure", async () => {
    const r = await checkLlm(target(), "wrong-key");
    expect(r).toMatchObject({ status: "down", failedAt: "auth", reason: "http_401", steps: { port: "ok", api: "ok", auth: "failed", models: "skipped" } });
  });

  it("no key configured: unknown (our config), not down", async () => {
    expect(await checkLlm(target(), undefined)).toMatchObject({ status: "unknown", failedAt: "auth", reason: "no_api_key" });
  });

  it("expected model missing: degraded, naming the missing model", async () => {
    models = ["bge-m3:latest"];
    const r = await checkLlm(target(port, ["qwen3.6:35b-a3b", "bge-m3:latest"]), KEY);
    expect(r).toMatchObject({ status: "degraded", failedAt: "models", missingModels: ["qwen3.6:35b-a3b"], steps: { auth: "ok", models: "failed" } });
  });

  it("the key never appears in the result", async () => {
    for (const r of [await checkLlm(target(), KEY), await checkLlm(target(), "wrong-key"), await checkLlm(target(closedPort), KEY)]) {
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });

  it("a model server address that does not end in /v1 is a config error", () => {
    expect(() => parseTargets({ llm: { name: "l", baseUrl: "https://x.example/v1/chat/completions", models: ["m"] } })).toThrow(/v1/);
  });
});
