import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: true,
  minify: false,
  // workspace 패키지(소스 모듈, shared)는 TS 소스 그대로 함께 묶는다. 바깥 의존성은 루트 node_modules에서 읽는다.
  noExternal: [/^@morning-desk\//],
  // 소스 모듈의 바깥 의존성은 묶지 않는다(CommonJS 패키지를 ESM 한 파일에 묶으면 동적 require가 깨진다).
  external: ["@azure/msal-node", "zod"],
  // CLI entrypoint — npm marks bin files executable on install.
  banner: { js: "#!/usr/bin/env node" },
});
