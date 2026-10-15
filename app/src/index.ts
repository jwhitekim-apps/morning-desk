// my-task original code (not derived from upstream).
import { runCli } from "./cli";
import { defaultRepoRoot } from "./config";

runCli(process.argv.slice(2), {
  out: (text) => void process.stdout.write(text),
  err: (text) => void process.stderr.write(text),
  env: process.env,
  repoRoot: defaultRepoRoot(),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error(`fatal: ${err instanceof Error ? err.message : "unexpected error"}`);
    process.exit(1);
  });
