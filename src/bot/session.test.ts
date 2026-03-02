import { describe, test, expect } from "bun:test";
import { getSessionKey } from "./session";

describe("getSessionKey", () => {
  test("DM", () => {
    expect(getSessionKey({
      chat: { id: 123, type: "private" }, message: {},
    } as any)).toBe("123:dm");
  });

  test("forum topic", () => {
    expect(getSessionKey({
      chat: { id: -100, type: "supergroup", is_forum: true },
      message: { message_thread_id: 42, is_topic_message: true },
    } as any)).toBe("-100:42");
  });

  test("forum general", () => {
    expect(getSessionKey({
      chat: { id: -100, type: "supergroup", is_forum: true },
      message: {},
    } as any)).toBe("-100:general");
  });
});
