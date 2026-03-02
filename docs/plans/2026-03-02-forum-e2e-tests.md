# Forum E2E Tests — Dynamic Forum Detection + Mock-Based Testing

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable dynamic forum supergroup registration (bot auto-detects when invited) and add comprehensive mock-based E2E tests for all forum/topic functionality.

**Architecture:** Add `forum_chats` DB table for registered forum groups. Extend auth middleware to allow messages from registered forums. Add `my_chat_member` handler for auto-registration. Build forum-specific update factories in the test harness and write E2E tests covering topic mapping, session isolation, and message routing.

**Tech Stack:** Bun, grammY, bun:sqlite, bun:test

---

## Task 1: ForumChatRepo — DB layer for registered forum groups

**Files:**
- Modify: `src/db/schema.ts:4-31` (add `forum_chats` table)
- Modify: `src/db/client.ts` (add `ForumChatRepo` class)
- Test: `src/db/client.test.ts`

**Step 1: Write the failing test**

Add to `src/db/client.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { ForumChatRepo } from "./client";

describe("ForumChatRepo", () => {
  function makeDb() {
    const db = new Database(":memory:");
    initSchema(db);
    return db;
  }

  test("register and check forum chat", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    expect(repo.isRegistered(-1001234)).toBe(false);
    repo.register(-1001234);
    expect(repo.isRegistered(-1001234)).toBe(true);
  });

  test("register is idempotent", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    repo.register(-1001234);
    repo.register(-1001234);
    expect(repo.isRegistered(-1001234)).toBe(true);
  });

  test("unregister removes chat", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    repo.register(-1001234);
    repo.unregister(-1001234);
    expect(repo.isRegistered(-1001234)).toBe(false);
  });

  test("allIds returns all registered chats", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    repo.register(-1001111);
    repo.register(-1002222);
    expect(repo.allIds()).toEqual([-1001111, -1002222]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/db/client.test.ts`
Expected: FAIL — `ForumChatRepo` not found

**Step 3: Write minimal implementation**

Add to `src/db/schema.ts` inside `initSchema`, after the `topic_mappings` table:

```sql
CREATE TABLE IF NOT EXISTS forum_chats (
  chat_id INTEGER PRIMARY KEY
);
```

Add to `src/db/client.ts`:

```ts
export class ForumChatRepo {
  constructor(private db: Database) {}

  register(chatId: number): void {
    this.db.prepare("INSERT OR IGNORE INTO forum_chats (chat_id) VALUES (?)").run(chatId);
  }

  unregister(chatId: number): void {
    this.db.prepare("DELETE FROM forum_chats WHERE chat_id = ?").run(chatId);
  }

  isRegistered(chatId: number): boolean {
    const row = this.db.prepare("SELECT 1 FROM forum_chats WHERE chat_id = ?").get(chatId);
    return !!row;
  }

  allIds(): number[] {
    const rows = this.db.prepare("SELECT chat_id FROM forum_chats").all() as { chat_id: number }[];
    return rows.map(r => r.chat_id);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/db/client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db/schema.ts src/db/client.ts src/db/client.test.ts
git commit -m "feat: add ForumChatRepo for dynamic forum group registration"
```

---

## Task 2: Auth middleware — allow forum group messages

**Files:**
- Modify: `src/bot/middleware/auth.ts`
- Modify: `src/bot/middleware/auth.test.ts`

**Step 1: Write the failing tests**

Replace `src/bot/middleware/auth.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { createAuthMiddleware } from "./auth";

describe("auth middleware", () => {
  test("allows authorized user in DM", async () => {
    const mw = createAuthMiddleware(12345);
    let called = false;
    await mw({ from: { id: 12345 } } as any, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("blocks unauthorized user in DM", async () => {
    const mw = createAuthMiddleware(12345);
    let called = false;
    await mw({ from: { id: 99999 } } as any, async () => { called = true; });
    expect(called).toBe(false);
  });

  test("blocks no from", async () => {
    const mw = createAuthMiddleware(12345);
    let called = false;
    await mw({ from: undefined } as any, async () => { called = true; });
    expect(called).toBe(false);
  });

  test("allows message from registered forum chat", async () => {
    const forumChatIds = new Set([-1001234]);
    const mw = createAuthMiddleware(12345, forumChatIds);
    let called = false;
    const ctx = { from: { id: 99999 }, chat: { id: -1001234 } } as any;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("blocks message from unregistered group", async () => {
    const forumChatIds = new Set([-1001234]);
    const mw = createAuthMiddleware(12345, forumChatIds);
    let called = false;
    const ctx = { from: { id: 99999 }, chat: { id: -1009999 } } as any;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/bot/middleware/auth.test.ts`
Expected: FAIL — new tests fail because `createAuthMiddleware` doesn't accept `forumChatIds`

**Step 3: Write minimal implementation**

Replace `src/bot/middleware/auth.ts`:

```ts
import type { Context, NextFunction } from "grammy";

export function createAuthMiddleware(allowedUserId: number, forumChatIds?: Set<number>) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (ctx.from?.id === allowedUserId) return next();
    if (forumChatIds && ctx.chat && forumChatIds.has(ctx.chat.id)) return next();
    return;
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/bot/middleware/auth.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/middleware/auth.ts src/bot/middleware/auth.test.ts
git commit -m "feat: auth middleware allows registered forum group messages"
```

---

## Task 3: Join handler — auto-register forum groups

**Files:**
- Create: `src/bot/handlers/join.ts`
- Test: `tests/e2e/forum.test.ts` (first test in the file)

**Step 1: Write the failing test**

Create `tests/e2e/forum.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { createTestDb, createTestBot } from "./harness";
import { ForumChatRepo } from "../../src/db/client";
import { setupJoinHandler } from "../../src/bot/handlers/join";
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
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/e2e/forum.test.ts`
Expected: FAIL — `setupJoinHandler` not found

**Step 3: Write minimal implementation**

Create `src/bot/handlers/join.ts`:

```ts
import type { Bot } from "grammy";
import type { ForumChatRepo } from "../../db/client";

export function setupJoinHandler(bot: Bot, forumChats: ForumChatRepo, forumChatIds: Set<number>) {
  bot.on("my_chat_member", (ctx) => {
    const chat = ctx.myChatMember.chat;
    if (chat.type !== "supergroup" || !(chat as any).is_forum) return;

    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "member" || status === "administrator") {
      forumChats.register(chat.id);
      forumChatIds.add(chat.id);
      console.log(`Forum registered: ${chat.id} ("${(chat as any).title}")`);
    } else if (status === "left" || status === "kicked") {
      forumChats.unregister(chat.id);
      forumChatIds.delete(chat.id);
      console.log(`Forum unregistered: ${chat.id}`);
    }
  });
}
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/e2e/forum.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/handlers/join.ts tests/e2e/forum.test.ts
git commit -m "feat: auto-register forum groups when bot is invited"
```

---

## Task 4: Harness — forum update factories

**Files:**
- Modify: `tests/e2e/harness.ts`

**Step 1: Add forum update factories to harness**

Add to `tests/e2e/harness.ts`:

```ts
export function makeForumTextUpdate(
  text: string,
  chatId: number,
  threadId: number,
  userId: number = 111,
): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: Math.floor(Date.now() / 1000),
      text,
      message_thread_id: threadId,
      is_topic_message: true,
      chat: { id: chatId, type: "supergroup", title: "Test Forum", is_forum: true },
      from: { id: userId, is_bot: false, first_name: "Test" },
      entities: [],
    },
  } as unknown as Update;
}

export function makeTopicCreatedUpdate(
  name: string,
  threadId: number,
  chatId: number,
  userId: number = 111,
): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: threadId,
      is_topic_message: true,
      chat: { id: chatId, type: "supergroup", title: "Test Forum", is_forum: true },
      from: { id: userId, is_bot: false, first_name: "Test" },
      forum_topic_created: { name, icon_color: 0x6FB9F0 },
    },
  } as unknown as Update;
}

export function makeTopicEditedUpdate(
  newName: string,
  threadId: number,
  chatId: number,
  userId: number = 111,
): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: Math.floor(Date.now() / 1000),
      message_thread_id: threadId,
      is_topic_message: true,
      chat: { id: chatId, type: "supergroup", title: "Test Forum", is_forum: true },
      from: { id: userId, is_bot: false, first_name: "Test" },
      forum_topic_edited: { name: newName },
    },
  } as unknown as Update;
}
```

**Step 2: Commit**

```bash
git add tests/e2e/harness.ts
git commit -m "feat: add forum update factories to E2E test harness"
```

---

## Task 5: E2E tests — topic mapping

**Files:**
- Modify: `tests/e2e/forum.test.ts`

**Step 1: Add topic mapping tests**

Append to `tests/e2e/forum.test.ts`:

```ts
import { TopicRepo } from "../../src/db/client";
import { setupForumHandlers } from "../../src/bot/handlers/forum";
import { makeTopicCreatedUpdate, makeTopicEditedUpdate } from "./harness";

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
```

**Step 2: Run tests**

Run: `bun test tests/e2e/forum.test.ts`
Expected: PASS (topic mapping uses existing code, tests validate real behavior)

**Step 3: Commit**

```bash
git add tests/e2e/forum.test.ts
git commit -m "test: E2E tests for forum topic mapping"
```

---

## Task 6: E2E tests — session isolation + message routing

**Files:**
- Modify: `tests/e2e/forum.test.ts`

**Step 1: Add session isolation and routing tests**

Append to `tests/e2e/forum.test.ts`:

```ts
import { createAuthMiddleware } from "../../src/bot/middleware/auth";
import { setupMessageHandler } from "../../src/bot/handlers/message";
import { mockRunClaude, makeForumTextUpdate, callsFor, sleep } from "./harness";
import type { KuzmaEvent } from "../../src/claude/events";
import type { Config } from "../../src/config";

const testConfig: Config = {
  telegramBotToken: "fake:token",
  telegramUserId: 111,
  telegramForumChatId: null,
  parakeetUrl: "http://localhost:5092",
  vaultPath: "/tmp/test-vault",
  workspacePath: "/tmp/test-workspace",
  dbPath: ":memory:",
  askUserBridgePort: 3847,
};

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
  });

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
  });

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
```

**Step 2: Run tests**

Run: `bun test tests/e2e/forum.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add tests/e2e/forum.test.ts
git commit -m "test: E2E tests for forum session isolation and message routing"
```

---

## Task 7: Wire up dynamic forum registration in src/index.ts

**Files:**
- Modify: `src/index.ts`
- Modify: `src/bot/telegram.ts`

**Step 1: Update src/index.ts**

Wire up `ForumChatRepo`, `setupJoinHandler`, and pass `forumChatIds` to auth:

```ts
// In src/index.ts, replace the current setup with:

import { ForumChatRepo } from "./db/client";
import { setupJoinHandler } from "./bot/handlers/join";

// After createDb:
const forumChats = new ForumChatRepo(db);
const forumChatIds = new Set(forumChats.allIds());

// Replace createBot call — pass forumChatIds:
const bot = new Bot(config.telegramBotToken);
bot.use(createAuthMiddleware(config.telegramUserId, forumChatIds));
bot.catch((err) => console.error("Bot error:", err));

// After bot creation, before setupMessageHandler:
setupJoinHandler(bot, forumChats, forumChatIds);
```

Key changes to `src/index.ts`:
- Import `ForumChatRepo` and `setupJoinHandler`
- Create `forumChatIds` Set from DB on startup
- Pass `forumChatIds` to `createAuthMiddleware`
- Call `setupJoinHandler` before message handler
- Import `createAuthMiddleware` directly instead of using `createBot` helper

**Step 2: Update src/bot/telegram.ts**

Update `createBot` to accept `forumChatIds`:

```ts
import { Bot } from "grammy";
import type { Config } from "../config";
import { createAuthMiddleware } from "./middleware/auth";

export function createBot(config: Config, forumChatIds?: Set<number>): Bot {
  const bot = new Bot(config.telegramBotToken);
  bot.use(createAuthMiddleware(config.telegramUserId, forumChatIds));
  bot.catch((err) => console.error("Bot error:", err));
  return bot;
}
```

Then in `src/index.ts` use `createBot(config, forumChatIds)` instead of inlining.

**Step 3: Commit**

```bash
git add src/index.ts src/bot/telegram.ts
git commit -m "feat: wire up dynamic forum registration in main entry"
```

---

## Task 8: Real Telegram test via ask_user MCP

**Files:** None — interactive test session

**Step 1:** Restart the bot: `bun run src/index.ts`

**Step 2:** Use `mcp__ask_user__ask_user` to ask user to:
1. Create a Telegram supergroup with forum topics enabled
2. Invite the bot to the group
3. Verify bot logs "Forum registered: <chat_id>"
4. Create a topic named "test"
5. Send a message in the "test" topic
6. Verify bot responds in the correct thread

**Step 3:** Fix any issues found during real testing

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: issues found during real Telegram forum testing"
```

---

## Task 9: Clean up — remove hardcoded TELEGRAM_FORUM_CHAT_ID dependency

**Files:**
- Modify: `src/config.ts` — keep `telegramForumChatId` for backward compat but mark optional
- Modify: `src/index.ts` — if `telegramForumChatId` is set, auto-register it in `forum_chats` on startup
- Modify: `.env.example` — add comment that it's optional

**Step 1: Add backward compat in src/index.ts**

After creating `forumChatIds`:

```ts
// Backward compat: if TELEGRAM_FORUM_CHAT_ID is set, register it
if (config.telegramForumChatId) {
  forumChats.register(config.telegramForumChatId);
  forumChatIds.add(config.telegramForumChatId);
}
```

**Step 2: Update .env.example**

```
TELEGRAM_FORUM_CHAT_ID=  # optional — bot auto-detects forum groups when invited
```

**Step 3: Commit**

```bash
git add src/index.ts src/config.ts .env.example
git commit -m "feat: TELEGRAM_FORUM_CHAT_ID is now optional, bot auto-detects"
```
