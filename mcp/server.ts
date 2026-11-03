// CallBook MCP server: a second client over the SAME Walrus Memory namespace as the web app.
// It only reads. Point Claude Desktop / Claude Code at it to ask "who should I trust on NFL?".
//
//   node --env-file=.env --experimental-strip-types mcp/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getMemory } from "../src/lib/memory.ts";
import { consensus, project, weights } from "../src/lib/scoring.ts";
import { suiConfigured } from "../src/lib/sui.ts";

/** Same rule as the web app: without a real Sui seal, simulated calls are shown but labelled. */
const includeSimulated = () => !suiConfigured();

async function view() {
  const { events, blobIds } = await getMemory().readAll();
  return { events, blobIds, v: project(events) };
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

const server = new McpServer({ name: "callbook", version: "0.1.0" });

server.tool(
  "callbook_credibility",
  "How much to trust each voice (friend, pundit or model), per category, learned from graded calls stored in Walrus Memory. 1.0 is neutral; above 1 has been right more often than a coin flip, below 1 has been wrong.",
  { category: z.string().optional().describe("e.g. nfl or politics; omit for overall") },
  async ({ category }) => {
    const { v, blobIds } = await view();
    const rows = weights(v, includeSimulated()).map((w) => ({
      voice: w.voiceId,
      weight: Number((category ? (w.byCategory[category] ?? 1) : w.overall).toFixed(2)),
      gradedCalls: w.nResolved,
    }));
    rows.sort((a, b) => b.weight - a.weight);
    return text(JSON.stringify({ category: category ?? "overall", memoriesRead: blobIds.length, voices: rows }, null, 2));
  },
);

server.tool(
  "callbook_open_markets",
  "Open (unresolved) markets with the credibility-weighted consensus next to the naive average of the voices' latest calls.",
  {},
  async () => {
    const { v } = await view();
    const rows = consensus(v, includeSimulated()).map((c) => ({
      question: v.markets.get(c.marketId)?.question,
      category: v.markets.get(c.marketId)?.category,
      credibilityWeighted: Number(c.weighted.toFixed(3)),
      naiveAverage: Number(c.naive.toFixed(3)),
      voices: c.nCalls,
    }));
    return text(JSON.stringify(rows, null, 2));
  },
);

server.tool(
  "callbook_voice_history",
  "Every call one voice has made, with the market, probability, outcome (if resolved) and how it was sealed.",
  { voice: z.string().describe("voice id, as returned by callbook_credibility") },
  async ({ voice }) => {
    const { v } = await view();
    const rows = v.calls
      .filter((c) => c.voiceId === voice)
      .map((c) => ({
        question: v.markets.get(c.marketId)?.question,
        category: v.markets.get(c.marketId)?.category,
        probabilityYes: c.p,
        outcome: v.resolved.has(c.marketId) ? (v.resolved.get(c.marketId) ? "YES" : "NO") : "open",
        seal: c.seal.mode === "sui-mainnet" ? `sui ${c.seal.digest}${c.seal.verified ? " (verified)" : ""}` : "simulated",
      }));
    return text(rows.length ? JSON.stringify(rows, null, 2) : `No calls found for voice "${voice}".`);
  },
);

await server.connect(new StdioServerTransport());
