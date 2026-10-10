// my-task original code (not derived from upstream).
import { z } from "zod";
import { MAX_BATCH, TEXT_LIMIT } from "../kakao/api";
import { defineTool } from "./_shared";

const DRY_RUN = z.boolean().optional().describe("If true, nothing is sent to Kakao; returns what would be sent and the character counts. The limits are checked the same way.");

export const sendTools = [
  defineTool({
    name: "send_to_me",
    description:
      `Send one text message to yourself in KakaoTalk ("나에게 보내기"). There is no recipient: it can only go to the signed-in user. ` +
      `Max ${TEXT_LIMIT} characters; longer messages are rejected, never truncated, so split them first.`,
    risk: "send",
    input: { text: z.string().describe(`Message text, up to ${TEXT_LIMIT} characters`), dryRun: DRY_RUN },
    handler: (args, ctx) => ctx.kakao.sendOne(args.text, { dryRun: args.dryRun }),
  }),

  defineTool({
    name: "send_many_to_me",
    description:
      `Send up to ${MAX_BATCH} text messages to yourself in KakaoTalk, in the given order. Each is at most ${TEXT_LIMIT} characters. ` +
      `If any message is invalid, none are sent.`,
    risk: "send",
    input: { messages: z.array(z.string()).describe(`1 to ${MAX_BATCH} messages, sent in order`), dryRun: DRY_RUN },
    handler: (args, ctx) => ctx.kakao.sendMany(args.messages, { dryRun: args.dryRun }),
  }),
];
