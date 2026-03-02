import { getConfig } from "./config";
import { createDb } from "./db/client";
import { createBot } from "./bot/telegram";
import { setupMessageHandler } from "./bot/handlers/message";
import { AskUserBridge } from "./bot/bridge";
import { setupCallbackHandler } from "./bot/handlers/callback";
import { setupForumHandlers } from "./bot/handlers/forum";
import { createVoiceHandler } from "./bot/handlers/voice";

async function main() {
  const config = getConfig();
  const db = createDb(config.dbPath);
  const bot = createBot(config);

  const { debouncer, ctxMap, processWithClaude } = setupMessageHandler(bot, config, db);

  // ask_user bridge
  const bridge = new AskUserBridge();
  const onQuestion = setupCallbackHandler(bot, bridge, config.telegramUserId);
  bridge.startServer(config.askUserBridgePort, onQuestion);

  // Forum topic auto-mapping
  setupForumHandlers(bot, db);
  bot.on("message:voice", createVoiceHandler(config, debouncer, ctxMap));

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
