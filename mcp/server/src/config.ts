// my-task original code (not derived from upstream).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { AppError } from "./errors";

/** 이름(서비스, 컨테이너, 모델 서버)의 모양. 도커 컨테이너 이름 규칙과 같고, 쉘 특수문자와 공백을 막는다. */
export const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const name = z.string().max(64).regex(NAME_PATTERN, "이름은 영문·숫자로 시작하고 영문·숫자·_ . - 만 쓸 수 있습니다");
const HOST_PATTERN = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$|^\[?[0-9a-fA-F:.]+\]?$/;

const httpUrl = z
  .string()
  .url("주소 형식이 아닙니다")
  .refine((u) => URL.canParse(u) && /^https?:$/.test(new URL(u).protocol), "http 또는 https 주소만 쓸 수 있습니다");

const ms = (d: number) => z.number().int().min(100).max(60_000).default(d);

const service = z.union([
  z.object({ name, url: httpUrl, timeoutMs: ms(5_000), slowMs: ms(2_000) }).strict(),
  z.object({ name, host: z.string().regex(HOST_PATTERN, "호스트 형식이 아닙니다"), port: z.number().int().min(1).max(65_535), timeoutMs: ms(5_000), slowMs: ms(2_000) }).strict(),
]);

const container = z.object({ name, restartWarn: z.number().int().min(1).max(1000).default(3) }).strict();

const llm = z
  .object({
    name,
    baseUrl: httpUrl.refine((u) => /\/v1\/?$/.test(u), "모델 서버 주소는 /v1 로 끝나야 합니다"),
    models: z.array(z.string().min(1).max(200)).min(1),
    timeoutMs: ms(5_000),
  })
  .strict();

const fileSchema = z
  .object({
    services: z.array(service).default([]),
    containers: z.array(container).default([]),
    llm: llm.optional(),
  })
  .strict();

export type ServiceTarget = z.infer<typeof service> & { plaintext: boolean };
export type ContainerTarget = z.infer<typeof container>;
export type LlmTarget = z.infer<typeof llm> & { plaintext: boolean; host: string; port: number };

export interface Targets {
  services: ServiceTarget[];
  containers: ContainerTarget[];
  llm: LlmTarget | undefined;
}

/** `SERVER_MCP_TARGETS`가 있으면 그 경로, 없으면 서버 폴더(`mcp/server/`)의 `targets.json`. */
export function targetsPath(env: NodeJS.ProcessEnv = process.env, entry: string | undefined = process.argv[1]): string {
  if (env.SERVER_MCP_TARGETS?.trim()) return resolve(env.SERVER_MCP_TARGETS.trim());
  return join(dirname(resolve(entry ?? ".")), "..", "targets.json");
}

/** 설정 파일을 읽고 검증한다. 대상이 하나도 없으면 `config_missing`, 형식이 틀리면 `config_error`. */
export function parseTargets(raw: unknown): Targets {
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.join(".") || "(root)";
    throw new AppError("config_error", `Invalid targets config at ${where}: ${issue?.message ?? "invalid"}`);
  }
  const { services, containers, llm: model } = parsed.data;
  const names = [...services.map((s) => s.name), ...containers.map((c) => `container:${c.name}`)];
  if (new Set(names).size !== names.length) throw new AppError("config_error", "Invalid targets config: duplicate names.");
  if (services.length === 0 && containers.length === 0 && !model) {
    throw new AppError("config_missing", "No check targets are configured (services, containers, llm are all empty).");
  }
  return {
    services: services.map((s) => ({ ...s, plaintext: "url" in s && s.url.startsWith("http:") })),
    containers,
    llm: model && withEndpoint(model),
  };
}

function withEndpoint(model: z.infer<typeof llm>): LlmTarget {
  const u = new URL(model.baseUrl);
  const plaintext = u.protocol === "http:";
  return { ...model, baseUrl: model.baseUrl.replace(/\/+$/, ""), plaintext, host: u.hostname, port: u.port ? Number(u.port) : plaintext ? 80 : 443 };
}

export function loadTargets(path: string): Targets {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new AppError("config_missing", "No targets config file. Create targets.json (see README).");
    throw new AppError("config_error", "The targets config file could not be read.");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError("config_error", "The targets config file is not valid JSON.");
  }
  return parseTargets(raw);
}
