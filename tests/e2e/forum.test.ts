import { describe, test, expect } from "bun:test";
import { createTestDb, createTestBot, makeTopicCreatedUpdate, makeTopicEditedUpdate } from "./harness";
import { ForumChatRepo, TopicRepo } from "../../src/db/client";
import { setupJoinHandler } from "../../src/bot/handlers/join";
import { setupForumHandlers } from "../../src/bot/handlers/forum";
import type { Update } from "grammy/types";

const FAKE_BOT_INFO = {
  id: 999, is_bot: true as const, first_name: "TestBot", username: "test_bot",
  can_join_groups: true, can_read_all_group_messages: false, supports_inline_queries: false,
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
