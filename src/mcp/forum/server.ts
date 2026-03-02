import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_URL = process.env.BOT_BRIDGE_URL || "http://localhost:3848";
const TIMEOUT_MS = 30_000;

const server = new McpServer({ name: "forum", version: "1.0.0" });

server.registerTool(
  "create_topic",
  {
    title: "Create Forum Topic",
    description: "Create a new topic in the Telegram forum group. Returns the thread ID.",
    inputSchema: z.object({
      name: z.string().describe("Topic name to create"),
    }),
  },
  async ({ name }) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/forum/create-topic`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        return { content: [{ type: "text" as const, text: `Error: ${err.error}` }] };
      }
      const data = await res.json() as { threadId: number; chatId: number; name: string };
      return { content: [{ type: "text" as const, text: `Created topic "${data.name}" (thread ${data.threadId}) in chat ${data.chatId}` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.registerTool(
  "list_topics",
  {
    title: "List Forum Topics",
    description: "List all mapped forum topics in the registered group.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const res = await fetch(`${BRIDGE_URL}/forum/topics`, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const data = await res.json() as { topics: { name: string; thread_id: number }[]; chatId: number | null };
      if (!data.chatId) {
        return { content: [{ type: "text" as const, text: "No forum group registered. Invite the bot to a supergroup with Topics enabled." }] };
      }
      if (!data.topics.length) {
        return { content: [{ type: "text" as const, text: `Forum group ${data.chatId} registered but no topics mapped yet. Use create_topic to create one.` }] };
      }
      const lines = data.topics.map(t => `- ${t.name} → thread ${t.thread_id}`);
      return { content: [{ type: "text" as const, text: `Topics in chat ${data.chatId}:\n${lines.join("\n")}` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

server.registerTool(
  "send_to_topic",
  {
    title: "Send to Forum Topic",
    description: "Send a message to a specific forum topic by name.",
    inputSchema: z.object({
      topic: z.string().describe("Topic name (case-insensitive)"),
      text: z.string().describe("Message text to send"),
    }),
  },
  async ({ topic, text }) => {
    try {
      const res = await fetch(`${BRIDGE_URL}/forum/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        return { content: [{ type: "text" as const, text: `Error: ${err.error}` }] };
      }
      const data = await res.json() as { threadId: number };
      return { content: [{ type: "text" as const, text: `Sent to topic "${topic}" (thread ${data.threadId})` }] };
    } catch (err: any) {
      return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((e) => { console.error(e); process.exit(1); });
