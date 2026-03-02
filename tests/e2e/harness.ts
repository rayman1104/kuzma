import { Bot } from "grammy";
import { Database } from "bun:sqlite";
import { initSchema } from "../../src/db/schema";
import type { KuzmaEvent } from "../../src/claude/events";
import type { RunOptions } from "../../src/claude/runner";
import type { Update, Message } from "grammy/types";

// ─── Database ────────────────────────────────────────────────────────────────

export function createTestDb(): Database {
  const db = new Database(":memory:");
  initSchema(db);
  return db;
}

// ─── API Call Capture ────────────────────────────────────────────────────────

export interface ApiCall {
  method: string;
  payload: Record<string, unknown>;
}

// ─── Bot Factory ─────────────────────────────────────────────────────────────

let nextMessageId = 1000;

export function createTestBot(userId: number = 111): {
  bot: Bot;
  apiCalls: ApiCall[];
} {
  const bot = new Bot("fake:token");
  const apiCalls: ApiCall[] = [];

  // Intercept ALL outgoing Telegram API calls via transformer
  bot.api.config.use((prev, method, payload, signal) => {
    apiCalls.push({ method, payload: payload as Record<string, unknown> });

    // Return minimal valid responses for common methods.
    // Grammy transformers must return { ok: true, result: T } — not the raw result.
    const msgId = nextMessageId++;
    const fakeMsg: Message.TextMessage = {
      message_id: msgId,
      date: Math.floor(Date.now() / 1000),
      chat: { id: Number((payload as any)?.chat_id) || userId, type: "private" },
      text: String((payload as any)?.text ?? ""),
    } as any;

    if (method === "sendMessage") return Promise.resolve({ ok: true, result: fakeMsg }) as any;
    if (method === "editMessageText") return Promise.resolve({ ok: true, result: fakeMsg }) as any;
    if (method === "sendChatAction") return Promise.resolve({ ok: true, result: true }) as any;
    if (method === "answerCallbackQuery") return Promise.resolve({ ok: true, result: true }) as any;
    if (method === "getMe") {
      return Promise.resolve({
        ok: true,
        result: { id: 999, is_bot: true, first_name: "TestBot", username: "test_bot" },
      }) as any;
    }
    // Fallback
    return Promise.resolve({ ok: true, result: true }) as any;
  });

  return { bot, apiCalls };
}

// ─── Mock Claude Runner ──────────────────────────────────────────────────────

export type ClaudeRunner = (options: RunOptions) => AsyncGenerator<KuzmaEvent>;

export function mockRunClaude(
  ...sequences: KuzmaEvent[][]
): { runner: ClaudeRunner; calls: RunOptions[] } {
  const calls: RunOptions[] = [];
  let callIndex = 0;

  async function* runner(options: RunOptions): AsyncGenerator<KuzmaEvent> {
    calls.push(options);
    const events = sequences[callIndex] ?? sequences[sequences.length - 1] ?? [];
    callIndex++;
    for (const event of events) {
      yield event;
    }
  }

  return { runner, calls };
}

// ─── Update Factories ────────────────────────────────────────────────────────

let updateId = 0;

export function makeTextUpdate(
  text: string,
  chatId: number = 111,
  userId: number = 111,
): Update {
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: Math.floor(Date.now() / 1000),
      text,
      chat: { id: chatId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "Test" },
      entities: [],
    },
  } as unknown as Update;
}

export function makeCommandUpdate(
  command: string,
  chatId: number = 111,
  userId: number = 111,
): Update {
  const text = `/${command}`;
  return {
    update_id: ++updateId,
    message: {
      message_id: ++updateId,
      date: Math.floor(Date.now() / 1000),
      text,
      chat: { id: chatId, type: "private" },
      from: { id: userId, is_bot: false, first_name: "Test" },
      entities: [{ type: "bot_command", offset: 0, length: text.length }],
    },
  } as unknown as Update;
}

export function makeCallbackUpdate(
  data: string,
  chatId: number = 111,
  userId: number = 111,
  messageId: number = 500,
): Update {
  return {
    update_id: ++updateId,
    callback_query: {
      id: String(++updateId),
      data,
      chat_instance: "test",
      from: { id: userId, is_bot: false, first_name: "Test" },
      message: {
        message_id: messageId,
        date: Math.floor(Date.now() / 1000),
        text: "Question?",
        chat: { id: chatId, type: "private" },
      },
    },
  } as unknown as Update;
}

// ─── Forum Update Factories ─────────────────────────────────────────────────

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

export function makeForumCommandUpdate(
  command: string,
  args: string,
  chatId: number,
  threadId: number,
  userId: number = 111,
): Update {
  const text = `/${command}${args ? " " + args : ""}`;
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
      entities: [{ type: "bot_command", offset: 0, length: command.length + 1 }],
    },
  } as unknown as Update;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function callsFor(apiCalls: ApiCall[], method: string): ApiCall[] {
  return apiCalls.filter(c => c.method === method);
}

export function sleep(ms: number): Promise<void> {
  return Bun.sleep(ms);
}
