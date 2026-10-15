// my-task original code (not derived from upstream).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// 경로에 공백이 있어도 되도록 `pathname`(퍼센트 인코딩) 대신 파일 경로로 바꾼다.
const SRC = fileURLToPath(new URL("../src", import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
const sources = files(SRC).map((f) => ({ file: relative(SRC, f), text: readFileSync(f, "utf-8") }));

describe("the code itself only runs docker and only asks the model server for its model list", () => {
  it("child processes are started in one place, with execFile('docker', ...) and no shell", () => {
    const users = sources.filter((s) => /node:child_process|child_process/.test(s.text)).map((s) => s.file);
    expect(users).toEqual(["checks/docker.ts"]);
    const docker = sources.find((s) => s.file === "checks/docker.ts")!.text;
    expect(docker).toMatch(/import \{ execFile \} from "node:child_process";/);
    // execFile 호출은 하나뿐이고 프로그램 이름은 "docker" 고정이다.
    expect(docker.match(/execFile\(/g)).toHaveLength(1);
    expect(docker).toMatch(/execFile\("docker", /);
    expect(docker).toContain("shell: false");
    for (const s of sources) {
      expect(s.text, s.file).not.toMatch(/(?<![.\w])(spawn|spawnSync|exec|execSync|execFileSync|fork)\(/);
      expect(s.text, s.file).not.toMatch(/shell:\s*true/);
    }
  });

  it("docker subcommands are only inspect and logs", () => {
    const sub = sources.flatMap((s) => [...s.text.matchAll(/return \["(\w+)"/g)].map((m) => m[1]));
    expect(sub.sort()).toEqual(["inspect", "logs"]);
  });

  it("the only model-server path in the code is /models; no generation path exists", () => {
    const all = sources.map((s) => s.text).join("\n");
    expect(all).not.toMatch(/chat\/completions|\/completions|\/embeddings|\/generate|\/api\/chat|\/api\/generate|\/responses|\/v1\/messages/);
    const llm = sources.find((s) => s.file === "checks/llm.ts")!.text;
    const paths = [...llm.matchAll(/`\$\{t\.baseUrl\}(\/[^`]*)`/g)].map((m) => m[1]);
    expect(paths).toEqual(["/models"]);
    // GET만 쓴다
    expect(all).not.toMatch(/method:\s*"(POST|PUT|PATCH|DELETE)"/);
  });
});
