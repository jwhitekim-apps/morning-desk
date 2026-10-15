import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist", "**/node_modules", "**/coverage", "openspec"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // 실행 결과는 stdout, 로그는 stderr(JSON 한 줄)로만 쓴다.
      "no-console": ["error", { allow: ["error", "warn"] }],
    },
  },
);
