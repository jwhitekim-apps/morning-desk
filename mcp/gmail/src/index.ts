// my-task original code (not derived from upstream).
import { execFile } from "node:child_process";
import { login } from "./auth/oauth";
import { loadOAuthClient, TokenStore } from "./auth/store";
import { loadConfig } from "./config";
import { runServer } from "./server";
import { VERSION } from "./version";

const HELP = `my-task-gmail-mcp ${VERSION}
Read-only Gmail MCP server (search and read; no send, delete or modify tools).

Usage:
  my-task-gmail-mcp [serve]      Start the MCP server on stdio (default)
  my-task-gmail-mcp login        Sign in with Google in a browser (one time, read-only Gmail access)
  my-task-gmail-mcp logout       Delete the saved sign-in
  my-task-gmail-mcp --version    Print version
`;

async function runLogin(): Promise<void> {
  const config = loadConfig();
  const client = loadOAuthClient(config);
  await login({
    store: new TokenStore(config.envFilePath),
    client,
    onUrl: (url) => {
      process.stderr.write(`Open this address in your browser and approve read-only Gmail access:\n\n${url}\n\n`);
      if (process.platform === "darwin") execFile("open", [url], () => undefined);
    },
  });
  process.stdout.write("Signed in. Refresh token saved to .env.local (owner-only permissions).\n");
}

async function main(): Promise<void> {
  const cmd = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "serve";
  const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => a.slice(2)));
  if (flags.has("version") || cmd === "version") return void process.stdout.write(`${VERSION}\n`);
  if (flags.has("help") || cmd === "help") return void process.stdout.write(HELP);
  if (cmd === "serve") return runServer();
  if (cmd === "login") return runLogin();
  if (cmd === "logout") {
    await new TokenStore(loadConfig().envFilePath).clear();
    return void process.stdout.write("Signed out (GMAIL_REFRESH_TOKEN removed from .env.local).\n");
  }
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error(`fatal: ${err instanceof Error ? err.message : "unexpected error"}`);
  process.exit(1);
});
