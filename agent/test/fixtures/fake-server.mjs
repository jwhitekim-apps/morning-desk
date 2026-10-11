// 테스트용 가짜 MCP 서버. 실제 자식 프로세스로 뜨는 서버를 흉내 낸다.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "fake", version: "0.0.0" });
const ok = (data) => ({ content: [{ type: "text", text: JSON.stringify(data) }] });

server.tool("echo", "echo the arguments and a few environment facts", { text: z.string().optional() }, async (args) =>
  ok({
    args,
    // 환경 변수 격리를 확인하기 위한 것: 값은 돌려주지 않고 이름만 알려 준다.
    envNames: Object.keys(process.env).filter((k) => /SECRET|TOKEN|KEY|PASSWORD|FAKE_/.test(k)).sort(),
  }),
);
server.tool("fail", "always returns a coded error", {}, async () => ({
  isError: true,
  content: [{ type: "text", text: JSON.stringify({ error: { code: "auth_expired", message: "Run login again." } }) }],
}));
server.tool("not_json", "returns text that is not JSON", {}, async () => ({ content: [{ type: "text", text: "<html>oops</html>" }] }));
server.tool("slow", "answers after a delay", { ms: z.number() }, async ({ ms }) => {
  await new Promise((r) => setTimeout(r, ms));
  return ok({ done: true });
});

await server.connect(new StdioServerTransport());
