import { describe, test, expect } from "bun:test";
import {
  createTestDb,
  createTestBot,
  mockRunClaude,
  makeTextUpdate,
  sleep,
} from "./harness";
import { setupMessageHandler } from "../../src/bot/handlers/message";
import { createAuthMiddleware } from "../../src/bot/middleware/auth";
import type { Config } from "../../src/config";

const testConfig: Config = {
  telegramBotToken: "fake:token",
  telegramUserId: 111,
  telegramApiRoot: "https://api.telegram.org",
  parakeetUrl: "http://localhost:5092",
  vaultPath: "/tmp/vault",
  workspacePath: "/tmp/workspace",
  dbPath: ":memory:",
  askUserBridgePort: 0,
};

// Each test waits up to 2x the debounce window (2000ms) plus processing time.
// Sequential scenarios need 2 * (2500 + 500) = 6000ms, so allow 10000ms per test.
const TEST_TIMEOUT = 10_000;

describe("debounce behavior", () => {
  test("Multiple messages within window are combined", async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);

    const { runner, calls } = mockRunClaude(
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r1" }, { type: "completed", sessionId: "s1" }],
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r2" }, { type: "completed", sessionId: "s1" }],
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r3" }, { type: "completed", sessionId: "s1" }],
    );

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    await bot.init();

    // Send 3 messages rapidly with no sleep between them
    await bot.handleUpdate(makeTextUpdate("Hello", 111, 111));
    await bot.handleUpdate(makeTextUpdate("world", 111, 111));
    await bot.handleUpdate(makeTextUpdate("!", 111, 111));

    // Wait for debounce window (2000ms) to fire + 500ms for processing
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(1);
    expect(calls[0].prompt).toBe("Hello\nworld\n!");
  }, TEST_TIMEOUT);

  test("Messages after window fire separately", async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);

    const { runner, calls } = mockRunClaude(
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r1" }, { type: "completed", sessionId: "s1" }],
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r2" }, { type: "completed", sessionId: "s1" }],
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r3" }, { type: "completed", sessionId: "s1" }],
    );

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    await bot.init();

    // Send first message, wait for debounce to fire
    await bot.handleUpdate(makeTextUpdate("first message", 111, 111));
    await sleep(2500);
    await sleep(500);

    // Send second message after the first window has closed, wait for debounce to fire
    await bot.handleUpdate(makeTextUpdate("second message", 111, 111));
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(2);
    expect(calls[0].prompt).toBe("first message");
    expect(calls[1].prompt).toBe("second message");
  }, TEST_TIMEOUT);

  test('"+" appends to recently fired message', async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);

    const { runner, calls } = mockRunClaude(
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r1" }, { type: "completed", sessionId: "s1" }],
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r2" }, { type: "completed", sessionId: "s1" }],
      [{ type: "started", sessionId: "s1" }, { type: "text", content: "r3" }, { type: "completed", sessionId: "s1" }],
    );

    bot.use(createAuthMiddleware(111));
    setupMessageHandler(bot, testConfig, db, runner);
    await bot.init();

    // Send original message, wait for debounce to fire (runner call 1)
    await bot.handleUpdate(makeTextUpdate("original", 111, 111));
    await sleep(2500);
    await sleep(500);

    // Send "+more stuff" — within the 30s extended window.
    // Debouncer sees "+" prefix, finds the ghost entry for this key,
    // and creates a new pending entry with [ghost.lastFired, clean] = ["original", "more stuff"].
    await bot.handleUpdate(makeTextUpdate("+more stuff", 111, 111));
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(2);
    // Second call should combine ghost ("original") + clean append ("more stuff")
    expect(calls[1].prompt).toBe("original\nmore stuff");
  }, TEST_TIMEOUT);
});
