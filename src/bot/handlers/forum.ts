import type { Api, Bot } from "grammy";
import { TopicRepo } from "../../db/client";
import type { Database } from "bun:sqlite";

export function setupForumHandlers(bot: Bot, db: Database) {
  const topics = new TopicRepo(db);

  bot.on("message:forum_topic_created", (ctx) => {
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id!;
    const name = ctx.message.forum_topic_created!.name.toLowerCase();
    topics.upsert(name, threadId, chatId);
    console.log(`Topic mapped: "${name}" → ${threadId}`);
  });

  bot.on("message:forum_topic_edited", (ctx) => {
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id!;
    const newName = (ctx.message as any).forum_topic_edited?.name;
    if (newName) {
      topics.deleteByThreadId(threadId, chatId);
      topics.upsert(newName.toLowerCase(), threadId, chatId);
    }
  });
}

/** Create a topic in a forum group via Bot API and save the mapping. */
export async function createForumTopic(
  api: Api, topics: TopicRepo, chatId: number, name: string,
): Promise<number> {
  const result = await api.createForumTopic(chatId, name);
  topics.upsert(name.toLowerCase(), result.message_thread_id, chatId);
  console.log(`Topic created: "${name}" → ${result.message_thread_id}`);
  return result.message_thread_id;
}

/** Get or create a topic thread ID by name. */
export async function getOrCreateTopic(
  api: Api, topics: TopicRepo, chatId: number, name: string,
): Promise<number> {
  const existing = topics.getThreadId(name.toLowerCase(), chatId);
  if (existing) return existing;
  return createForumTopic(api, topics, chatId, name);
}
