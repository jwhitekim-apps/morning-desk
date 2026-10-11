// my-task original code (not derived from upstream).
import { z } from "zod";
import { AppError } from "../errors";
import type { ToolCaller } from "../mcp/pool";

const SendResult = z.object({ dryRun: z.boolean(), sent: z.number(), messages: z.array(z.object({ index: z.number(), chars: z.number() }).passthrough()) });

export interface Delivery {
  dryRun: boolean;
  /** 실제로 카카오에 보낸 통수. 드라이런이면 0. */
  sent: number;
  /** 통마다 글자 수. */
  chars: number[];
}

/**
 * 말풍선을 카톡 나에게 보내기로 보낸다. 드라이런이면 카카오 서버의 드라이런(검사만 하고 아무것도 보내지 않음)을 부른다.
 * 그래서 드라이런에서도 글자 수 한도 검사는 실제 전송과 같이 적용된다.
 */
export async function deliver(caller: ToolCaller, messages: readonly string[], opts: { dryRun: boolean }): Promise<Delivery> {
  if (messages.length === 0) throw new AppError("validation_error", "There is nothing to send.");
  const raw = await caller.call("kakao", "send_many_to_me", { messages: [...messages], dryRun: opts.dryRun });
  const parsed = SendResult.safeParse(raw);
  if (!parsed.success) throw new AppError("tool_error", "Kakao's send answer has an unexpected shape.", { toolCode: "contract_changed" });
  return { dryRun: parsed.data.dryRun, sent: parsed.data.sent, chars: parsed.data.messages.map((m) => m.chars) };
}
