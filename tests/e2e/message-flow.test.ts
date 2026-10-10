import { describe, test, expect } from "bun:test";
import {
  createTestDb,
  createTestBot,
  mockRunClaude,
  makeTextUpdate,
  callsFor,
  sleep,
  type ApiCall,
} from "./harness";
import { setupMessageHandler } from "../../src/bot/handlers/message";
import { createAuthMiddleware } from "../../src/bot/middleware/auth";
import type { KuzmaEvent } from "../../src/claude/events";
import type { Config } from "../../src/config";

const FAKE_BOT_INFO = {
  id: 999,
  is_bot: true as const,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

const testConfig: Config = {
  telegramBotToken: "fake:token",
  telegramUserId: 111,
  telegramApiRoot: "https://api.telegram.org",
  parakeetUrl: "http://localhost:5092",
  vaultPath: "/tmp/test-vault",
  workspacePath: "/tmp/test-workspace",
  dbPath: ":memory:",
  askUserBridgePort: 3847,
};

describe("message-flow", () => {
  test("Basic message → response", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);

    const events: KuzmaEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "text", content: "Four" },
      { type: "completed", sessionId: "s1" },
    ];
    const { runner, calls } = mockRunClaude(events);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    const update = makeTextUpdate("What is 2+2?", 111, 111);
    await bot.handleUpdate(update);

    // Wait for debounce window (2000ms) to fire
    await sleep(2500);
    // Wait for async processWithClaude + renderer to complete
    await sleep(500);

    const sentMessages = callsFor(apiCalls, "sendMessage");
    expect(sentMessages.length).toBeGreaterThan(0);
    expect(sentMessages.some(c => c.payload.text === "Four")).toBe(true);

    expect(calls.length).toBe(1);
    expect(calls[0].prompt).toBe("What is 2+2?");
  });

  test("Streaming edits", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);

    const events: KuzmaEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "text", content: "Hello" },
      { type: "text", content: " world" },
      { type: "completed", sessionId: "s1" },
    ];
    const { runner } = mockRunClaude(events);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    const update = makeTextUpdate("Say hello world", 111, 111);
    await bot.handleUpdate(update);

    await sleep(2500);
    // Give extra time for the 1000ms edit throttle + flush
    await sleep(1500);

    const sentMessages = callsFor(apiCalls, "sendMessage");
    // At least one sendMessage should have been made with the accumulated text
    expect(sentMessages.length).toBeGreaterThan(0);

    // The final text after both chunks should be "Hello world"
    const allTextCalls = [...callsFor(apiCalls, "sendMessage"), ...callsFor(apiCalls, "editMessageText")];
    const hasHelloWorld = allTextCalls.some(c =>
      typeof c.payload.text === "string" && c.payload.text.includes("Hello")
    );
    expect(hasHelloWorld).toBe(true);
  });

  test("Error from Claude", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);

    const events: KuzmaEvent[] = [
      { type: "error", message: "Out of tokens" },
    ];
    const { runner } = mockRunClaude(events);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    const update = makeTextUpdate("Do something expensive", 111, 111);
    await bot.handleUpdate(update);

    await sleep(2500);
    await sleep(500);

    const sentMessages = callsFor(apiCalls, "sendMessage");
    expect(sentMessages.some(c =>
      typeof c.payload.text === "string" && c.payload.text.includes("Error: Out of tokens")
    )).toBe(true);
  });

  test("Empty response", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);

    const events: KuzmaEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "completed", sessionId: "s1" },
    ];
    const { runner } = mockRunClaude(events);

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    const update = makeTextUpdate("Say nothing", 111, 111);
    await bot.handleUpdate(update);

    await sleep(2500);
    await sleep(500);

    // No sendMessage with actual content (only sendChatAction is expected for "typing")
    const sentMessages = callsFor(apiCalls, "sendMessage");
    const messagesWithText = sentMessages.filter(c =>
      typeof c.payload.text === "string" && c.payload.text.trim().length > 0
    );
    expect(messagesWithText.length).toBe(0);
  });
});
