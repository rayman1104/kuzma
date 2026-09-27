import { describe, test, expect } from "bun:test";
import { parseStreamLine } from "./parser";

describe("parseStreamLine", () => {
  test("parses system init", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "abc-123" });
    expect(parseStreamLine(line)).toEqual({ type: "started", sessionId: "abc-123" });
  });

  test("parses assistant text", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    });
    expect(parseStreamLine(line)).toEqual({ type: "text", content: "Hello" });
  });

  test("parses tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }] },
    });
    expect(parseStreamLine(line)).toEqual({ type: "tool_use", name: "Read", input: { file_path: "/x" } });
  });

  test("parses result", () => {
    const line = JSON.stringify({
      type: "result", subtype: "success", session_id: "abc", total_cost_usd: 0.05, duration_ms: 12000,
    });
    expect(parseStreamLine(line)).toEqual({
      type: "completed", sessionId: "abc", cost: 0.05, duration: 12000, isError: false, subtype: "success",
    });
  });

  test("marks errored result", () => {
    const line = JSON.stringify({
      type: "result", subtype: "error_during_execution", session_id: "dead", is_error: true,
    });
    expect(parseStreamLine(line)).toEqual({
      type: "completed", sessionId: "dead", cost: undefined, duration: undefined,
      isError: true, subtype: "error_during_execution",
    });
  });

  test("returns null for unknown types", () => {
    expect(parseStreamLine(JSON.stringify({ type: "unknown" }))).toBeNull();
  });

  test("returns error for invalid JSON", () => {
    const event = parseStreamLine("not json{");
    expect(event?.type).toBe("error");
  });
});
