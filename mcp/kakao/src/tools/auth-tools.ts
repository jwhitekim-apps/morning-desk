// my-task original code (not derived from upstream).
import { defineTool } from "./_shared";

export const authTools = [
  defineTool({
    name: "auth_status",
    description: "Report whether Kakao credentials are configured (REST API key, client secret, where the refresh token comes from). Never returns secret values.",
    risk: "auth",
    input: {},
    handler: async (_args, ctx) => ctx.auth.status(),
  }),
];
