import { getConfig } from "./config";
import { startWatchdog } from "./watchdog";
import { createDb } from "./db/client";
import { createBot } from "./bot/telegram";
import { setupMessageHandler } from "./bot/handlers/message";
import { AskUserBridge } from "./bot/bridge";
import { setupCallbackHandler } from "./bot/handlers/callback";
import { setupForumHandlers } from "./bot/handlers/forum";
import { createVoiceHandler } from "./bot/handlers/voice";
import { Scheduler } from "./scheduler/engine";
import { TopicRepo } from "./db/client";
import { TaskRepo } from "./scheduler/tasks";

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

  // Scheduler
  const topicRepo = new TopicRepo(db);
  async function deliver(to: string, text: string) {
    if (to === "dm") { await bot.api.sendMessage(config.telegramUserId, text); return; }
    if (to.startsWith("topic:") && config.telegramForumChatId) {
      const tid = topicRepo.getThreadId(to.slice(6), config.telegramForumChatId);
      const opts: any = {};
      if (tid && tid !== 1) opts.message_thread_id = tid;
      await bot.api.sendMessage(config.telegramForumChatId, text, opts);
      return;
    }
    await bot.api.sendMessage(config.telegramUserId, text);
  }

  const scheduler = new Scheduler(config, db, deliver);
  scheduler.start();

  // /tasks command
  bot.command("tasks", async (ctx) => {
    const taskRepo = new TaskRepo(db);
    const active = taskRepo.listActive();
    if (!active.length) { await ctx.reply("No active tasks."); return; }
    const lines = active.map(t => `- ${t.what} (${t.urgency}) → ${t.deliver_to} | \`${t.schedule}\``);
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  console.log("Kuzma starting...");
  bot.start({
    onStart: async (botInfo) => {
      console.log(`Bot @${botInfo.username} is running`);
      try { await bot.api.sendMessage(config.telegramUserId, "Kuzma online."); } catch {}
    },
  });

  startWatchdog();

  const shutdown = () => { console.log("Shutting down..."); scheduler.stop(); bot.stop(); db.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (e) => console.error("Unhandled:", e));
}

main().catch(console.error);
