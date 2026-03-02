import { describe, test, expect } from "bun:test";
import { TelegramRenderer } from "../../src/claude/renderer";
import { sleep } from "./harness";

function createMockApi() {
  const calls: Array<{ method: string; args: any[] }> = [];
  let nextMsgId = 100;
  let editError: Error | null = null;

  const api = {
    sendChatAction: async (...args: any[]) => {
      calls.push({ method: "sendChatAction", args });
      return true;
    },
    sendMessage: async (...args: any[]) => {
      const msgId = nextMsgId++;
      calls.push({ method: "sendMessage", args });
      return {
        message_id: msgId,
        date: 0,
        chat: { id: args[0], type: "private" },
        text: args[1],
      };
    },
    editMessageText: async (...args: any[]) => {
      if (editError) throw editError;
      calls.push({ method: "editMessageText", args });
      return {
        message_id: args[1],
        date: 0,
        chat: { id: args[0], type: "private" },
        text: args[2],
      };
    },
    setEditError: (err: Error | null) => {
      editError = err;
    },
  };

  return { api: api as any, calls, setEditError: api.setEditError };
}

describe("TelegramRenderer flush() error handling", () => {
  test('"not modified" error does not duplicate message', async () => {
    const { api, calls, setEditError } = createMockApi();
    const renderer = new TelegramRenderer(api, 111);

    // Feed text event — scheduleEdit queues a doEdit after throttle delay
    await renderer.handleEvent({ type: "text", content: "Hello" });

    // Wait for throttle to fire → doEdit sends the first message (sets messageId)
    await sleep(1100);

    const sendCountAfterInit = calls.filter(c => c.method === "sendMessage").length;
    expect(sendCountAfterInit).toBe(1);

    // Now make editMessageText throw "not modified"
    const err = Object.assign(new Error("not modified"), {
      description: "Bad Request: message is not modified",
    });
    setEditError(err);

    // completed triggers flush() → editMessageText throws "not modified" → NO sendNew
    await renderer.handleEvent({ type: "completed", sessionId: "s1" });

    const sendCountFinal = calls.filter(c => c.method === "sendMessage").length;
    expect(sendCountFinal).toBe(1); // still exactly 1, no duplicate
  });

  test("other edit error triggers sendNew fallback", async () => {
    const { api, calls, setEditError } = createMockApi();
    const renderer = new TelegramRenderer(api, 111);

    await renderer.handleEvent({ type: "text", content: "Hello" });

    // Wait for doEdit to fire → first sendMessage sets messageId
    await sleep(1100);

    const sendCountAfterInit = calls.filter(c => c.method === "sendMessage").length;
    expect(sendCountAfterInit).toBe(1);

    // Make editMessageText throw a different error
    const err = Object.assign(new Error("not found"), {
      description: "Bad Request: message to edit not found",
    });
    setEditError(err);

    // completed triggers flush() → editMessageText throws other error → sendNew IS called
    await renderer.handleEvent({ type: "completed", sessionId: "s1" });

    const sendCountFinal = calls.filter(c => c.method === "sendMessage").length;
    expect(sendCountFinal).toBe(2); // initial + fallback
  });
});
