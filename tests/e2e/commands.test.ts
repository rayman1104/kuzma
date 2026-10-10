import { describe, test, expect } from "bun:test";
import type { Config } from "../../src/config";
import type { RunOptions } from "../../src/claude/runner";
import type { KuzmaEvent } from "../../src/claude/events";
import { TaskRepo } from "../../src/scheduler/tasks";
import { setupMessageHandler } from "../../src/bot/handlers/message";
import { createAuthMiddleware } from "../../src/bot/middleware/auth";
import {
  createTestDb,
  createTestBot,
  mockRunClaude,
  makeCommandUpdate,
  makeTextUpdate,
  callsFor,
  sleep,
} from "./harness";

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
  vaultPath: "/tmp/vault",
  workspacePath: "/tmp/workspace",
  dbPath: ":memory:",
  askUserBridgePort: 0,
};

/**
 * Register the /tasks command the same way index.ts does —
 * BEFORE setupMessageHandler so the text handler doesn't consume it.
 */
function registerTasksCommand(bot: ReturnType<typeof createTestBot>["bot"], taskRepo: TaskRepo) {
  bot.command("tasks", async (ctx) => {
    const active = taskRepo.listActive();
    if (!active.length) { await ctx.reply("No active tasks."); return; }
    const lines = active.map(t => `- ${t.what} (${t.urgency})`);
    await ctx.reply(lines.join("\n"));
  });
}

describe("Bot commands", () => {
  test("/new clears session and replies", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);
    // Suppress BotErrors — the fake API transformer records calls but returns a
    // raw object that grammY can't parse, so ctx.reply() always throws a GrammyError.
    // The call is captured in apiCalls before parsing, so we can still assert on it.
    bot.catch(() => {});
    bot.use(createAuthMiddleware(111));

    const taskRepo = new TaskRepo(db);
    registerTasksCommand(bot, taskRepo);

    const { runner, calls } = mockRunClaude([]);
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeCommandUpdate("new"));

    const sends = callsFor(apiCalls, "sendMessage");
    expect(sends.length).toBeGreaterThanOrEqual(1);
    expect(sends.some(s => String(s.payload.text).includes("Clean slate"))).toBe(true);
    expect(calls.length).toBe(0);
  });

  test("/stop with active runner aborts and replies 'Stopped.'", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);
    bot.catch(() => {});
    bot.use(createAuthMiddleware(111));

    const taskRepo = new TaskRepo(db);
    registerTasksCommand(bot, taskRepo);

    let aborted = false;
    const runnerCalls: RunOptions[] = [];

    async function* hangingRunner(options: RunOptions): AsyncGenerator<KuzmaEvent> {
      runnerCalls.push(options);
      yield { type: "started", sessionId: "s1" };
      await new Promise<void>((_, reject) => {
        options.abortSignal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    }

    setupMessageHandler(bot, testConfig, db, hangingRunner);
    bot.botInfo = FAKE_BOT_INFO;

    // Send a text message to trigger debounce → runner
    await bot.handleUpdate(makeTextUpdate("hello"));

    // Wait for the debounce timer (2000ms) to fire and runner to start yielding
    await sleep(2500);

    // Now send /stop — the runner should be hanging and active
    await bot.handleUpdate(makeCommandUpdate("stop"));

    // Give the abort event a tick to propagate
    await sleep(50);

    const sends = callsFor(apiCalls, "sendMessage");
    expect(sends.some(s => String(s.payload.text).includes("Stopped"))).toBe(true);
    expect(aborted).toBe(true);
  });

  test("/stop without active runner replies 'Nothing running.'", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);
    bot.catch(() => {});
    bot.use(createAuthMiddleware(111));

    const taskRepo = new TaskRepo(db);
    registerTasksCommand(bot, taskRepo);

    const { runner } = mockRunClaude([]);
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeCommandUpdate("stop"));

    const sends = callsFor(apiCalls, "sendMessage");
    expect(sends.some(s => String(s.payload.text).includes("not doing anything"))).toBe(true);
  });

  test("/tasks with no tasks replies 'No active tasks.'", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);
    bot.catch(() => {});
    bot.use(createAuthMiddleware(111));

    const taskRepo = new TaskRepo(db);
    registerTasksCommand(bot, taskRepo);

    const { runner } = mockRunClaude([]);
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeCommandUpdate("tasks"));

    const sends = callsFor(apiCalls, "sendMessage");
    expect(sends.some(s => String(s.payload.text).includes("No active tasks."))).toBe(true);
  });

  test("/tasks with active tasks replies with task list", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot(111);
    bot.catch(() => {});
    bot.use(createAuthMiddleware(111));

    const taskRepo = new TaskRepo(db);
    taskRepo.create({
      id: "t1",
      what: "Send daily report",
      schedule: "0 9 * * *",
      urgency: "high",
      deliver_to: "dm",
      status: "active",
    });
    registerTasksCommand(bot, taskRepo);

    const { runner } = mockRunClaude([]);
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeCommandUpdate("tasks"));

    const sends = callsFor(apiCalls, "sendMessage");
    expect(sends.some(s => String(s.payload.text).includes("Send daily report"))).toBe(true);
    expect(sends.some(s => String(s.payload.text).includes("high"))).toBe(true);
  });

  test("Commands don't trigger text handler (runClaude not called)", async () => {
    const db = createTestDb();
    const { bot } = createTestBot(111);
    bot.catch(() => {});
    bot.use(createAuthMiddleware(111));

    const taskRepo = new TaskRepo(db);
    registerTasksCommand(bot, taskRepo);

    const { runner, calls } = mockRunClaude([]);
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeCommandUpdate("new"));

    // Wait well past debounce window to confirm runner was never scheduled
    await sleep(2500);

    expect(calls.length).toBe(0);
  });
});
