import { getConfig } from "./config";
import { createDb } from "./db/client";
import { createBot } from "./bot/telegram";
import { setupMessageHandler } from "./bot/handlers/message";

async function main() {
  const config = getConfig();
  const db = createDb(config.dbPath);
  const bot = createBot(config);

  setupMessageHandler(bot, config, db);

  console.log("Kuzma starting...");
  bot.start({
    onStart: async (botInfo) => {
      console.log(`Bot @${botInfo.username} is running`);
      try { await bot.api.sendMessage(config.telegramUserId, "Kuzma online."); } catch {}
    },
  });

  const shutdown = () => { bot.stop(); db.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(console.error);
