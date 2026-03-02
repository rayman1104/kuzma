import { Bot } from "grammy";
import type { Config } from "../config";
import { createAuthMiddleware } from "./middleware/auth";

export function createBot(config: Config): Bot {
  const bot = new Bot(config.telegramBotToken);
  bot.use(createAuthMiddleware(config.telegramUserId));
  bot.catch((err) => console.error("Bot error:", err));
  return bot;
}
