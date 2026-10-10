// my-task original code (not derived from upstream).
import { defineTool } from "./_shared";

export const authTools = [
  defineTool({
    name: "auth_status",
    description:
      "Report whether the Gmail sign-in exists. Never returns tokens. Sign in from a terminal with `my-task-gmail-mcp login`; this server cannot sign in by itself.",
    risk: "auth",
    input: {},
    handler: async (_args, ctx) => ctx.auth.status(),
  }),
];
