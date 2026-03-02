import type { Bot } from "grammy";
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
    if (newName) topics.upsert(newName.toLowerCase(), threadId, chatId);
  });
}
