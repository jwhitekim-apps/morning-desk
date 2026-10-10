// my-task original code (not derived from upstream).
import { z } from "zod";
import { DEFAULT_LIMIT, MAX_LIMIT, SYNCED_AT_NOTE } from "../folio/api";
import { defineTool } from "./_shared";

const MAX_RESULTS = z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}`);

export const paperTools = [
  defineTool({
    name: "list_recent_papers",
    description:
      "List papers from the Folio library (Zotero), most recently SYNCED first, optionally only those synced since a time. " +
      `${SYNCED_AT_NOTE} Keep your own record of when you first saw a paper if you need "new papers". ` +
      "If `truncated` is true there are more papers than maxResults. Dates are Korea time.",
    risk: "read",
    input: {
      since: z.string().optional().describe("Only papers synced at or after this: YYYY-MM-DD (Korea time) or an ISO 8601 date-time"),
      maxResults: MAX_RESULTS,
    },
    handler: (args, ctx) => ctx.folio.listRecent({ since: args.since, maxResults: args.maxResults }),
  }),

  defineTool({
    name: "search_papers",
    description:
      "Find Folio papers whose title contains the given text (case-insensitive; the text is matched literally, special characters included). " +
      `Most recently synced first. ${SYNCED_AT_NOTE}`,
    risk: "read",
    input: { query: z.string().min(1).describe("Text to look for in titles"), maxResults: MAX_RESULTS },
    handler: (args, ctx) => ctx.folio.search({ query: args.query, maxResults: args.maxResults }),
  }),
];
