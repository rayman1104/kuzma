import type { KuzmaEvent } from "./events";

export function parseStreamLine(line: string): KuzmaEvent | null {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return { type: "error", message: `Failed to parse: ${line.slice(0, 100)}` };
  }

  if (msg.type === "system" && msg.subtype === "init") {
    return { type: "started", sessionId: msg.session_id };
  }

  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text") return { type: "text", content: block.text };
      if (block.type === "tool_use") return { type: "tool_use", name: block.name, input: block.input };
    }
  }

  if (msg.type === "result") {
    return {
      type: "completed",
      sessionId: msg.session_id ?? "",
      cost: msg.total_cost_usd,
      duration: msg.duration_ms,
      isError: msg.is_error === true,
      subtype: msg.subtype,
    };
  }

  return null;
}
