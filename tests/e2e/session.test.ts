import { describe, test, expect } from "bun:test";
import {
  createTestDb,
  createTestBot,
  mockRunClaude,
  makeTextUpdate,
  makeCommandUpdate,
  sleep,
} from "./harness";
import { setupMessageHandler } from "../../src/bot/handlers/message";
import { createAuthMiddleware } from "../../src/bot/middleware/auth";
import { SessionRepo } from "../../src/db/client";
import type { KuzmaEvent } from "../../src/claude/events";
import type { Config } from "../../src/config";

const testConfig: Config = {
  telegramBotToken: "fake:token",
  telegramUserId: 111,
  parakeetUrl: "http://localhost:5092",
  vaultPath: "/tmp/vault",
  workspacePath: "/tmp/workspace",
  dbPath: ":memory:",
  askUserBridgePort: 0,
};

describe("session continuity", () => {
  test("First message creates session", async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);

    const events: KuzmaEvent[] = [
      { type: "started", sessionId: "session-abc" },
      { type: "text", content: "hi" },
      { type: "completed", sessionId: "session-abc" },
    ];
    const { runner, calls } = mockRunClaude(events);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    await bot.init();

    const update = makeTextUpdate("Hello", 111, 111);
    await bot.handleUpdate(update);

    await sleep(2500);
    await sleep(500);

    // First call should have no stored session
    expect(calls.length).toBe(1);
    expect(calls[0].sessionId).toBeUndefined();

    // Session should now be stored in the DB under key "111:dm" (private chat)
    const sessions = new SessionRepo(db);
    expect(sessions.get("111:dm")).toBe("session-abc");
  }, 5000);

  test("Second message resumes session", async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);

    const seq1: KuzmaEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "text", content: "first response" },
      { type: "completed", sessionId: "s1" },
    ];
    const seq2: KuzmaEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "text", content: "second response" },
      { type: "completed", sessionId: "s1" },
    ];
    const { runner, calls } = mockRunClaude(seq1, seq2);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    await bot.init();

    // Send first message
    const update1 = makeTextUpdate("First message", 111, 111);
    await bot.handleUpdate(update1);
    await sleep(2500);
    await sleep(500);

    // Send second message
    const update2 = makeTextUpdate("Second message", 111, 111);
    await bot.handleUpdate(update2);
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(2);
    // First call: no stored session
    expect(calls[0].sessionId).toBeUndefined();
    // Second call: resumes with session id stored after first call
    expect(calls[1].sessionId).toBe("s1");
  }, 10000);

  test("/new resets session", async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);

    const seq1: KuzmaEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "text", content: "first response" },
      { type: "completed", sessionId: "s1" },
    ];
    const seq2: KuzmaEvent[] = [
      { type: "started", sessionId: "s2" },
      { type: "text", content: "fresh response" },
      { type: "completed", sessionId: "s2" },
    ];
    const { runner, calls } = mockRunClaude(seq1, seq2);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    await bot.init();

    // Send first message — stores session "s1"
    const update1 = makeTextUpdate("First message", 111, 111);
    await bot.handleUpdate(update1);
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(1);
    expect(calls[0].sessionId).toBeUndefined();

    // Send /new command — deletes the stored session for this key
    const newCmd = makeCommandUpdate("new", 111, 111);
    await bot.handleUpdate(newCmd);
    await sleep(100);

    // Send second message — should NOT pass a sessionId (session was reset)
    const update2 = makeTextUpdate("After reset", 111, 111);
    await bot.handleUpdate(update2);
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(2);
    // After /new, stored session was deleted; second call has no sessionId
    expect(calls[1].sessionId).toBeUndefined();
  }, 10000);

  test("Different chats have isolated sessions", async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);

    const seqA: KuzmaEvent[] = [
      { type: "started", sessionId: "chat-a-session" },
      { type: "text", content: "response for A" },
      { type: "completed", sessionId: "chat-a-session" },
    ];
    const seqB: KuzmaEvent[] = [
      { type: "started", sessionId: "chat-b-session" },
      { type: "text", content: "response for B" },
      { type: "completed", sessionId: "chat-b-session" },
    ];
    const { runner, calls } = mockRunClaude(seqA, seqB);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    await bot.init();

    // Message from chatId 111, userId 111 (passes auth)
    const updateA = makeTextUpdate("Hello from chat A", 111, 111);
    await bot.handleUpdate(updateA);
    await sleep(2500);
    await sleep(500);

    // Message from chatId 222, userId 111 (same user, different chat — passes auth)
    const updateB = makeTextUpdate("Hello from chat B", 222, 111);
    await bot.handleUpdate(updateB);
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(2);
    // Both are first messages in their respective chats — no stored session for either
    expect(calls[0].sessionId).toBeUndefined();
    expect(calls[1].sessionId).toBeUndefined();

    // Verify sessions are stored under separate chat-scoped keys
    const sessions = new SessionRepo(db);
    expect(sessions.get("111:dm")).toBe("chat-a-session");
    expect(sessions.get("222:dm")).toBe("chat-b-session");
  }, 10000);
});
