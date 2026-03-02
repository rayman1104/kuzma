import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_URL = process.env.BOT_BRIDGE_URL || "http://localhost:3847";
const TIMEOUT_MS = 5 * 60 * 1000;

const server = new McpServer({ name: "ask_user", version: "1.0.0" });

server.registerTool(
  "ask_user",
  {
    title: "Ask User",
    description: "Present a question with optional inline button choices via Telegram.",
    inputSchema: z.object({
      question: z.string().describe("Question to ask"),
      options: z.array(z.string()).optional().describe("Button choices"),
    }),
  },
  async ({ question, options }) => {
    const requestId = crypto.randomUUID();
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BRIDGE_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, question, options }),
        signal: ac.signal,
      });
      if (!res.ok) return { content: [{ type: "text" as const, text: `Bridge error: ${res.status}` }] };
      const data = (await res.json()) as { answer: string };
      return { content: [{ type: "text" as const, text: data.answer }] };
    } catch (err: any) {
      const msg = err.name === "AbortError"
        ? "User did not respond within 5 minutes."
        : `Error: ${err.message}`;
      return { content: [{ type: "text" as const, text: msg }] };
    } finally {
      clearTimeout(timeout);
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((e) => { console.error(e); process.exit(1); });
