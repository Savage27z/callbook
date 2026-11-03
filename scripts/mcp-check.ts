// Spawns the MCP server over stdio, lists its tools and calls each one (read-only against Walrus).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--env-file=.env", "--experimental-strip-types", "--no-warnings", "mcp/server.ts"],
  env: { ...(process.env as Record<string, string>) },
});
const client = new Client({ name: "mcp-check", version: "0.0.1" });
await client.connect(transport);

console.log("tools:", (await client.listTools()).tools.map((t) => t.name).join(", "));
const show = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
  console.log(`\n== ${name} ${JSON.stringify(args)}${res.isError ? " (ERROR)" : ""}\n${res.content[0].text}`);
};
await show("callbook_credibility");
await show("callbook_credibility", { category: "nfl" });
await show("callbook_open_markets");
await show("callbook_voice_history", { voice: "sharp" });
await client.close();
