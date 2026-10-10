import { Bot } from "grammy";
import type { Config } from "../config";
import { createAuthMiddleware } from "./middleware/auth";

export function createBot(config: Config, forumChatIds?: Set<number>): Bot {
  const bot = new Bot(config.telegramBotToken, { client: { apiRoot: config.telegramApiRoot } });
  bot.use(createAuthMiddleware(config.telegramUserId, forumChatIds));
  bot.catch((err) => console.error("Bot error:", err));
  return bot;
}
