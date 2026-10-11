// my-task original code (not derived from upstream).
import { createServer, type Server } from "node:http";
import { createServer as createTcpServer, type AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkServices } from "../src/checks/services";
import { parseTargets } from "../src/config";

let http: Server;
let base: string;
let closedPort: number;

beforeAll(async () => {
  http = createServer((req, res) => {
    if (req.url === "/ok") return void res.end("ok");
    if (req.url === "/slow") return void setTimeout(() => res.end("late"), 400);
    if (req.url === "/error") return void res.writeHead(503).end();
    if (req.url === "/redirect") return void res.writeHead(302, { location: "http://example.invalid/" }).end();
    // /hang: 응답하지 않는다
  });
  await new Promise<void>((r) => http.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  // 열었다 닫은 포트: 연결 거부
  const tmp = createTcpServer();
  await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", r));
  closedPort = (tmp.address() as AddressInfo).port;
  await new Promise<void>((r) => tmp.close(() => r()));
});
afterAll(() => {
  http.closeAllConnections();
  http.close();
});

const targets = () =>
  parseTargets({
    services: [
      { name: "fast", url: `${base}/ok`, slowMs: 300 },
      { name: "slow", url: `${base}/slow`, slowMs: 200, timeoutMs: 2000 },
      { name: "hang", url: `${base}/hang`, timeoutMs: 300 },
      { name: "refused", url: `http://127.0.0.1:${closedPort}/` },
      { name: "broken", url: `${base}/error` },
      { name: "moved", url: `${base}/redirect` },
      { name: "tcp-open", host: "127.0.0.1", port: Number(new URL(base).port) },
      { name: "tcp-closed", host: "127.0.0.1", port: closedPort },
    ],
  }).services;

describe("service checks", () => {
  it("tells ok, slow (degraded), no answer (down) and refused (down) apart, and one failure does not stop the rest", async () => {
    const r = await checkServices(targets());
    const by = Object.fromEntries(r.map((x) => [x.name, x]));
    expect(r.map((x) => x.name)).toEqual(["fast", "slow", "hang", "refused", "broken", "moved", "tcp-open", "tcp-closed"]);
    expect(by.fast).toMatchObject({ kind: "http", status: "ok", httpStatus: 200, plaintext: true });
    expect(by.slow).toMatchObject({ status: "degraded", reason: "slow" });
    expect(by.hang).toMatchObject({ status: "down", reason: "timeout" });
    expect(by.refused).toMatchObject({ status: "down", reason: "refused" });
    expect(by.broken).toMatchObject({ status: "degraded", reason: "http_503", httpStatus: 503 });
    expect(by.moved).toMatchObject({ status: "ok", httpStatus: 302 }); // 리다이렉트를 따라가지 않는다
    expect(by["tcp-open"]).toMatchObject({ kind: "tcp", status: "ok" });
    expect(by["tcp-closed"]).toMatchObject({ kind: "tcp", status: "down", reason: "refused" });
    for (const x of r) expect(x.durationMs).toBeGreaterThanOrEqual(0);
    expect(by.hang!.durationMs).toBeLessThan(1500);
  });

  it("never runs more than 4 checks at once", async () => {
    let active = 0;
    let peak = 0;
    const fetchFn = (async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return new Response("ok");
    }) as typeof fetch;
    const many = parseTargets({ services: Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, url: `https://s${i}.example/` })) }).services;
    const r = await checkServices(many, { fetchFn });
    expect(r).toHaveLength(10);
    expect(peak).toBe(4);
  });

  it("a thrown error becomes a short reason, never the original message", async () => {
    const fetchFn = (async () => {
      throw Object.assign(new TypeError("fetch failed: secret-host-detail"), { cause: { code: "ENOTFOUND" } });
    }) as typeof fetch;
    const [r] = await checkServices(parseTargets({ services: [{ name: "x", url: "https://x.example/" }] }).services, { fetchFn });
    expect(r).toMatchObject({ status: "down", reason: "dns" });
    expect(JSON.stringify(r)).not.toContain("secret-host-detail");
  });
});
