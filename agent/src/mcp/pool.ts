// my-task original code (not derived from upstream).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AppError } from "../errors";
import type { Logger } from "../logger";
import type { ServerName, ServerSpec } from "../config";

/** 도구 호출의 추상. 실제 구현은 `McpPool`, 테스트는 가짜로 바꾼다. */
export interface ToolCaller {
  /** 서버의 도구를 부르고 JSON으로 해석한 결과를 돌려준다. 도구가 오류를 돌려주면 `tool_error`로 던진다. */
  call(server: ServerName, tool: string, args?: Record<string, unknown>, opts?: { timeoutMs?: number }): Promise<unknown>;
  /** 서버가 내놓는 도구 이름 목록. */
  tools(server: ServerName): Promise<string[]>;
  close(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 120_000;

/** MCP 서버를 표준입출력 자식 프로세스로 필요할 때 띄우고, 끝나면 모두 닫는다. */
export class McpPool implements ToolCaller {
  private readonly clients = new Map<ServerName, Promise<Client>>();

  constructor(private readonly specs: Partial<Record<ServerName, ServerSpec>>, private readonly logger: Logger) {}

  private connect(name: ServerName): Promise<Client> {
    let p = this.clients.get(name);
    if (!p) {
      p = this.start(name);
      // 연결에 실패하면 다음 호출에서 다시 시도할 수 있도록 남겨 두지 않는다.
      p.catch(() => this.clients.delete(name));
      this.clients.set(name, p);
    }
    return p;
  }

  private async start(name: ServerName): Promise<Client> {
    const spec = this.specs[name];
    if (!spec) throw new AppError("config_error", `No MCP server configured for "${name}".`);
    const startedAt = Date.now();
    const transport = new StdioClientTransport({ command: process.execPath, args: [spec.entry, "serve"], env: spec.env, stderr: "pipe" });
    // 자식의 로그(JSON 한 줄)는 읽어서 버린다. 읽지 않으면 파이프가 차서 자식이 멈출 수 있고, 내용은 이쪽 로그에 옮기지 않는다.
    transport.stderr?.on("data", () => undefined);
    const client = new Client({ name: "my-task-agent", version: "0.0.1" });
    try {
      await client.connect(transport);
    } catch {
      throw new AppError("server_unavailable", `Could not start the "${name}" MCP server. Is it built (npm run build in its folder)?`);
    }
    this.logger.info("server started", { server: name, durationMs: Date.now() - startedAt });
    return client;
  }

  async tools(server: ServerName): Promise<string[]> {
    const client = await this.connect(server);
    return (await client.listTools()).tools.map((t) => t.name).sort();
  }

  async call(server: ServerName, tool: string, args: Record<string, unknown> = {}, opts: { timeoutMs?: number } = {}): Promise<unknown> {
    const client = await this.connect(server);
    const startedAt = Date.now();
    let res;
    try {
      res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS });
    } catch (err) {
      const timedOut = err instanceof Error && /timed out|timeout/i.test(err.message);
      this.logger.warn("tool call failed", { server, tool, durationMs: Date.now() - startedAt, errorCode: timedOut ? "timeout" : "server_unavailable" });
      throw new AppError(timedOut ? "timeout" : "server_unavailable", `The "${server}" MCP server did not answer ${tool}.`);
    }
    const text = (res.content as { type: string; text?: string }[] | undefined)?.find((c) => c.type === "text")?.text ?? "";
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AppError("tool_error", `The "${server}" ${tool} answer was not JSON.`);
    }
    if (res.isError) {
      const e = (data as { error?: { code?: string; message?: string } })?.error;
      this.logger.warn("tool returned an error", { server, tool, durationMs: Date.now() - startedAt, errorCode: e?.code ?? "unknown" });
      // 서버가 준 메시지는 고정 문구이지만, 안전하게 코드만 위로 올린다.
      throw new AppError("tool_error", `${server}.${tool} failed${e?.code ? ` (${e.code})` : ""}${e?.message ? `: ${e.message}` : ""}`, { toolCode: e?.code });
    }
    this.logger.debug("tool ok", { server, tool, durationMs: Date.now() - startedAt });
    return data;
  }

  async close(): Promise<void> {
    const pending = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(pending.map(async (p) => (await p).close()));
  }
}
