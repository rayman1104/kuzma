export type KuzmaEvent =
  | { type: "started"; sessionId: string }
  | { type: "text"; content: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string }
  | { type: "completed"; sessionId: string; cost?: number; duration?: number }
  | { type: "error"; message: string };
