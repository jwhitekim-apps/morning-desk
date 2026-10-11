// my-task original code (not derived from upstream).
import { join } from "node:path";
import { loadConfig } from "./config";
import { loadEnvFile } from "./env";
import { createLogger } from "./logger";
import { McpPool } from "./mcp/pool";
import { MemoryStore } from "./memory";
import { LlmClient } from "./model/client";
import { run } from "./run";
import { VERSION } from "./version";

const HELP = `my-task-agent ${VERSION}

Usage:
  my-task-agent list-tools [server...]   Start the MCP servers and print the tools each one offers
  my-task-agent run [--dry-run] [--force] Build today's briefing and send it
                                         --dry-run: read and ask the model, but send, add and record nothing; print the briefing
                                         --force:   send again even if today's briefing was already sent
  my-task-agent --version                Print version
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--version")) return void process.stdout.write(`${VERSION}\n`);
  if (args.length === 0 || args.includes("--help")) return void process.stdout.write(HELP);
  const cmd = args[0];

  const config = loadConfig();
  loadEnvFile(join(config.repoRoot, ".env.local"));
  const fresh = loadConfig(); // .env.local을 읽은 뒤의 환경으로 다시 만든다
  const logger = createLogger(fresh.logLevel);

  if (cmd === "list-tools") {
    const pool = new McpPool(fresh.servers, logger);
    try {
      const wanted = args.slice(1).length > 0 ? args.slice(1) : Object.keys(fresh.servers);
      for (const name of wanted) {
        try {
          process.stdout.write(`${name}: ${(await pool.tools(name as keyof typeof fresh.servers)).join(", ")}\n`);
        } catch (err) {
          process.stdout.write(`${name}: (failed) ${err instanceof Error ? err.message : "error"}\n`);
        }
      }
    } finally {
      await pool.close();
    }
    return;
  }
  if (cmd === "run") {
    const dryRun = args.includes("--dry-run");
    const pool = new McpPool(fresh.servers, logger);
    try {
      const configured = Boolean(fresh.llm.baseUrl && fresh.llm.apiKey);
      const result = await run(
        { caller: pool, model: configured ? new LlmClient(fresh.llm, logger) : null, memory: new MemoryStore(fresh.memoryPath), logger },
        {
          dryRun,
          force: args.includes("--force"),
          createTasks: fresh.createTasks,
          maxCreates: fresh.maxCreates,
          listName: fresh.listName,
          collect: { enabled: fresh.sources, githubNotifications: fresh.githubNotifications, mailQuery: fresh.mailQuery },
        },
      );
      if (result.status === "already-sent") {
        process.stdout.write("오늘 브리핑은 이미 보냈어요. 다시 보내려면 --force를 붙이세요.\n");
        process.exitCode = 3;
      } else if (dryRun) {
        // 드라이런은 만들어질 브리핑을 화면에 보여 준다(보내지 않는다). 실제 실행은 내용을 출력하지 않고 건수만 알린다.
        result.messages.forEach((m, i) => process.stdout.write(`--- ${i + 1}/${result.messages.length} (${m.length}자) ---\n${m}\n`));
        const planned = result.plan?.toCreate ?? [];
        if (planned.length > 0) process.stdout.write(`\n추가 예정 태스크 ${planned.length}건:\n${planned.map((t) => `- ${t.title} (마감 ${t.due ?? "없음"})`).join("\n")}\n`);
        process.stdout.write(`\n(드라이런: 카톡 전송, To Do 추가, 기록 저장을 하지 않았어요)\n`);
      } else {
        process.stdout.write(`브리핑 ${result.delivery?.sent ?? 0}통을 보냈어요. 추가한 태스크 ${result.writes?.created.length ?? 0}건.\n`);
      }
    } finally {
      await pool.close();
    }
    return;
  }
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(`fatal: ${err instanceof Error ? err.message : "unexpected error"}`);
  process.exit(1);
});
