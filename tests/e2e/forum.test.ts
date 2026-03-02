import { describe, test, expect } from "bun:test";
import { createTestDb, createTestBot, makeTopicCreatedUpdate, makeTopicEditedUpdate, makeForumTextUpdate, mockRunClaude, callsFor, sleep } from "./harness";
import { ForumChatRepo, TopicRepo } from "../../src/db/client";
import { setupJoinHandler } from "../../src/bot/handlers/join";
import { setupForumHandlers } from "../../src/bot/handlers/forum";
import { createAuthMiddleware } from "../../src/bot/middleware/auth";
import { setupMessageHandler } from "../../src/bot/handlers/message";
import type { KuzmaEvent } from "../../src/claude/events";
import type { Config } from "../../src/config";
import type { Update } from "grammy/types";

const FAKE_BOT_INFO = {
  id: 999, is_bot: true as const, first_name: "TestBot", username: "test_bot",
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
};

const testConfig: Config = {
  telegramBotToken: "fake:token",
  telegramUserId: 111,
  parakeetUrl: "http://localhost:5092",
  vaultPath: "/tmp/test-vault",
  workspacePath: "/tmp/test-workspace",
  dbPath: ":memory:",
  askUserBridgePort: 3847,
};

let updateId = 5000;

function makeMyChatMemberUpdate(chatId: number, isForum: boolean, newStatus: string): Update {
  return {
    update_id: ++updateId,
    my_chat_member: {
      chat: { id: chatId, type: "supergroup", title: "Test Forum", ...(isForum ? { is_forum: true } : {}) },
      from: { id: 111, is_bot: false, first_name: "Test" },
      date: Math.floor(Date.now() / 1000),
      old_chat_member: { user: { id: 999, is_bot: true, first_name: "TestBot" }, status: "left" },
      new_chat_member: { user: { id: 999, is_bot: true, first_name: "TestBot" }, status: newStatus },
    },
  } as unknown as Update;
}

describe("forum join handler", () => {
  test("registers forum group when bot is added", async () => {
    const db = createTestDb();
    const { bot } = createTestBot();
    const forumChats = new ForumChatRepo(db);
    const forumChatIds = new Set<number>();
    setupJoinHandler(bot, forumChats, forumChatIds);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeMyChatMemberUpdate(-1001234, true, "member"));
    expect(forumChats.isRegistered(-1001234)).toBe(true);
    expect(forumChatIds.has(-1001234)).toBe(true);
  });

  test("ignores non-forum groups", async () => {
    const db = createTestDb();
    const { bot } = createTestBot();
    const forumChats = new ForumChatRepo(db);
    const forumChatIds = new Set<number>();
    setupJoinHandler(bot, forumChats, forumChatIds);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeMyChatMemberUpdate(-1005555, false, "member"));
    expect(forumChats.isRegistered(-1005555)).toBe(false);
  });

  test("unregisters when bot is removed from forum", async () => {
    const db = createTestDb();
    const { bot } = createTestBot();
    const forumChats = new ForumChatRepo(db);
    forumChats.register(-1001234);
    const forumChatIds = new Set([-1001234]);
    setupJoinHandler(bot, forumChats, forumChatIds);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeMyChatMemberUpdate(-1001234, true, "left"));
    expect(forumChats.isRegistered(-1001234)).toBe(false);
    expect(forumChatIds.has(-1001234)).toBe(false);
  });
});

describe("forum topic mapping", () => {
  test("topic_created saves mapping to DB", async () => {
    const db = createTestDb();
    const { bot } = createTestBot();
    const topics = new TopicRepo(db);
    setupForumHandlers(bot, db);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeTopicCreatedUpdate("daily", 42, -1001234));
    expect(topics.getThreadId("daily", -1001234)).toBe(42);
  });

  test("topic_edited updates mapping", async () => {
    const db = createTestDb();
    const { bot } = createTestBot();
    const topics = new TopicRepo(db);
    setupForumHandlers(bot, db);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeTopicCreatedUpdate("daily", 42, -1001234));
    await bot.handleUpdate(makeTopicEditedUpdate("standup", 42, -1001234));
    expect(topics.getThreadId("standup", -1001234)).toBe(42);
    expect(topics.getThreadId("daily", -1001234)).toBeNull();
  });

  test("topic name is lowercased", async () => {
    const db = createTestDb();
    const { bot } = createTestBot();
    const topics = new TopicRepo(db);
    setupForumHandlers(bot, db);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeTopicCreatedUpdate("My Topic", 99, -1001234));
    expect(topics.getThreadId("my topic", -1001234)).toBe(99);
  });
});

describe("forum message routing", () => {
  test("message in topic → response with correct thread_id", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot();
    const forumChatIds = new Set([-1001234]);

    const events: KuzmaEvent[] = [
      { type: "started", sessionId: "s1" },
      { type: "text", content: "Reply from topic" },
      { type: "completed", sessionId: "s1" },
    ];
    const { runner } = mockRunClaude(events);

    bot.use(createAuthMiddleware(111, forumChatIds));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeForumTextUpdate("Hello from topic", -1001234, 42));
    await sleep(2500);
    await sleep(500);

    const sent = callsFor(apiCalls, "sendMessage");
    const topicMessages = sent.filter(c => c.payload.message_thread_id === 42);
    expect(topicMessages.length).toBeGreaterThan(0);
  });

  test("different topics get different session keys", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot();
    const forumChatIds = new Set([-1001234]);

    const events1: KuzmaEvent[] = [
      { type: "started", sessionId: "session-topic-42" },
      { type: "text", content: "Reply 1" },
      { type: "completed", sessionId: "session-topic-42" },
    ];
    const events2: KuzmaEvent[] = [
      { type: "started", sessionId: "session-topic-99" },
      { type: "text", content: "Reply 2" },
      { type: "completed", sessionId: "session-topic-99" },
    ];
    const { runner, calls } = mockRunClaude(events1, events2);

    bot.use(createAuthMiddleware(111, forumChatIds));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeForumTextUpdate("Msg in topic 42", -1001234, 42));
    await sleep(2500);
    await sleep(500);

    await bot.handleUpdate(makeForumTextUpdate("Msg in topic 99", -1001234, 99));
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(2);
    // First call should have no existing session (undefined)
    expect(calls[0].sessionId).toBeUndefined();
    // Second call also no existing session (different topic = different key)
    expect(calls[1].sessionId).toBeUndefined();
  }, 15000);

  test("same topic reuses session", async () => {
    const db = createTestDb();
    const { bot } = createTestBot();
    const forumChatIds = new Set([-1001234]);

    const events: KuzmaEvent[] = [
      { type: "started", sessionId: "s-persist" },
      { type: "text", content: "OK" },
      { type: "completed", sessionId: "s-persist" },
    ];
    const { runner, calls } = mockRunClaude(events, events);

    bot.use(createAuthMiddleware(111, forumChatIds));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeForumTextUpdate("First", -1001234, 42));
    await sleep(2500);
    await sleep(500);

    await bot.handleUpdate(makeForumTextUpdate("Second", -1001234, 42));
    await sleep(2500);
    await sleep(500);

    expect(calls.length).toBe(2);
    expect(calls[1].sessionId).toBe("s-persist");
  }, 15000);

  test("thread_id 1 (General) sends without message_thread_id", async () => {
    const db = createTestDb();
    const { bot, apiCalls } = createTestBot();
    const forumChatIds = new Set([-1001234]);

    const events: KuzmaEvent[] = [
      { type: "started", sessionId: "s-general" },
      { type: "text", content: "General reply" },
      { type: "completed", sessionId: "s-general" },
    ];
    const { runner } = mockRunClaude(events);

    bot.use(createAuthMiddleware(111, forumChatIds));
    setupMessageHandler(bot, testConfig, db, runner);
    bot.botInfo = FAKE_BOT_INFO;

    await bot.handleUpdate(makeForumTextUpdate("In general", -1001234, 1));
    await sleep(2500);
    await sleep(500);

    const sent = callsFor(apiCalls, "sendMessage");
    const withThread = sent.filter(c => c.payload.message_thread_id !== undefined);
    // General topic (thread_id=1) → renderer strips it
    expect(withThread.length).toBe(0);
  });
});
