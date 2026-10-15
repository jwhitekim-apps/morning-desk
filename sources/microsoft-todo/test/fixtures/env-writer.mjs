// my-task original code (not derived from upstream).
// 테스트용 자식 프로세스: env-file로 한 키를 N번(0이면 끝없이) 고쳐 쓴다.
import { openEnvFile } from "../../src/env-file.ts";

const [path, key, countArg, staleArg] = process.argv.slice(2);
const count = Number(countArg);
const file = openEnvFile({ keys: [key], path, lockTimeoutMs: 30_000, staleLockMs: Number(staleArg ?? 30_000) });
for (let i = 0; count === 0 || i < count; i++) {
  await file.set(key, `${key}-${i}`);
}
