// my-task original code (not derived from upstream).
import { existsSync, readFileSync } from "node:fs";

/** `KEY=VALUE` 줄을 읽는다(주석 `#`과 따옴표 지원). 이미 있는 환경 변수는 덮어쓰지 않는다. 파일이 없으면 아무것도 하지 않는다. */
export function loadEnvFile(path: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    const key = m[1] as string;
    let value = m[2] as string;
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (env[key] === undefined) env[key] = value;
  }
}
