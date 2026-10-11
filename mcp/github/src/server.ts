// my-task original code (not derived from upstream).
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, type AppConfig } from "./config";
import { toAppError } from "./errors";
import { GithubApi } from "./github/api";
import { GithubClient } from "./github/client";
import { createLogger, type Logger } from "./logger";
import { allTools } from "./tools/registry";
import { errorResult, okResult, type ToolContext, type ToolDef } from "./tools/_shared";
import { VERSION } from "./version";

/** 도구를 등록한 MCP 서버를 만든다(연결은 하지 않는다). 테스트가 메모리 연결로 같은 서버를 쓴다. */
export function createServer(ctx: ToolContext, tools: readonly ToolDef[] = allTools): McpServer {
  const server = new McpServer({ name: "my-task-github-mcp", version: VERSION });
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.inputShape, async (args: Record<string, unknown>) => {
      const startedAt = Date.now();
      const log = ctx.logger.child({ tool: tool.name });
      try {
        const result = await tool.handler(args, ctx);
        log.info("tool ok", { durationMs: Date.now() - startedAt, outcome: "ok" });
        return okResult(result);
      } catch (err) {
        const appError = toAppError(err);
        log.error("tool error", { durationMs: Date.now() - startedAt, outcome: "error", errorCode: appError.code });
        return errorResult(appError);
      }
    });
  }
  return server;
}

export async function runServer(config: AppConfig = loadConfig(), logger: Logger = createLogger(config.logLevel)): Promise<void> {
  const client = new GithubClient(logger, { token: config.token, notificationsToken: config.notificationsToken });
  const github = new GithubApi(client, logger, config.repos);
  const server = createServer({ logger, github });
  logger.info("my-task-github-mcp starting", { version: VERSION, registeredTools: allTools.length });
  await server.connect(new StdioServerTransport());
  // stdio 전송이 이벤트 루프를 붙잡고 있다가 stdin이 닫히면 종료된다.
}
