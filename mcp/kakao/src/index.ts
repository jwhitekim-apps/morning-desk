// my-task original code (not derived from upstream).
import { runServer } from "./server";
import { VERSION } from "./version";

const HELP = `my-task-kakao-mcp ${VERSION}
KakaoTalk send-to-me MCP server (sends text to yourself only; cannot read chats or message friends).

Usage:
  my-task-kakao-mcp [serve]      Start the MCP server on stdio (default)
  my-task-kakao-mcp --version    Print version
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args.find((a) => !a.startsWith("--")) ?? "serve";
  const flags = new Set(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
  if (flags.has("version") || cmd === "version") return void process.stdout.write(`${VERSION}\n`);
  if (flags.has("help") || cmd === "help") return void process.stdout.write(HELP);
  if (cmd === "serve") return runServer();
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(`fatal: ${err instanceof Error ? err.message : "unexpected error"}`);
  process.exit(1);
});
