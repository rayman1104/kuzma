import { resolve } from "path";
import { getConfig } from "./config";
import { startWatchdog } from "./watchdog";
import { createDb, ForumChatRepo } from "./db/client";
import { createBot } from "./bot/telegram";
import { setupMessageHandler } from "./bot/handlers/message";
import { AskUserBridge } from "./bot/bridge";
import { setupCallbackHandler } from "./bot/handlers/callback";
import { setupForumHandlers, getOrCreateTopic } from "./bot/handlers/forum";
import { setupJoinHandler } from "./bot/handlers/join";
import { createVoiceHandler } from "./bot/handlers/voice";
import { createForumRoutes } from "./bot/routes/forum";
import { createPhotoHandler, createDocumentHandler } from "./bot/handlers/photo";
import { Scheduler } from "./scheduler/engine";
import { TopicRepo } from "./db/client";
import { TaskRepo } from "./scheduler/tasks";
import { loadPersona, DEFAULT_PERSONA, type Persona } from "./persona";
import { createOnboarding } from "./bot/handlers/onboarding";

async function main() {
  const config = getConfig();
  const db = createDb(config.dbPath);
  const forumChats = new ForumChatRepo(db);
  const forumChatIds = new Set(forumChats.allIds());
  const bot = createBot(config, forumChatIds);

  // Load persona (or enter onboarding mode)
  const personaPath = resolve(config.dbPath, "..", "persona.json");
  let persona: Persona | null = loadPersona(personaPath);

  let onboarding: ReturnType<typeof createOnboarding> | null = null;
  if (!persona) {
    onboarding = createOnboarding(bot.api, config.telegramUserId, personaPath, config.workspacePath, (p) => {
      persona = p;
      onboarding = null;
    });
  }

  // Onboarding interceptor — must be registered BEFORE setupMessageHandler
  bot.on("message:text", (ctx, next) => {
    if (onboarding && !onboarding.isComplete()) {
      if (ctx.from?.id === config.telegramUserId && ctx.chat.type === "private") {
        onboarding.handleMessage(ctx.message.text);
        return; // don't call next()
      }
    }
    return next();
  });

  // /tasks command — register before setupMessageHandler so it's not consumed by text handler
  bot.command("tasks", async (ctx) => {
    const taskRepo = new TaskRepo(db);
    const active = taskRepo.listActive();
    if (!active.length) { await ctx.reply("No active tasks."); return; }
    const lines = active.map(t => `- ${t.what} (${t.urgency}) → ${t.deliver_to} | \`${t.schedule}\``);
    await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
  });

  const { debouncer, ctxMap, processWithClaude } = setupMessageHandler(bot, config, db);

  // ask_user bridge + forum routes
  const topicRepo = new TopicRepo(db);
  const bridge = new AskUserBridge();
  const onQuestion = setupCallbackHandler(bot, bridge, config.telegramUserId);
  bridge.addRoutes(createForumRoutes(bot.api, topicRepo, forumChats));
  bridge.startServer(config.askUserBridgePort, onQuestion);

  // Dynamic forum registration (must be before forum handlers)
  setupJoinHandler(bot, forumChats, forumChatIds);

  // Forum topic auto-mapping
  setupForumHandlers(bot, db);
  bot.on("message:voice", createVoiceHandler(config, debouncer, ctxMap));
  bot.on("message:photo", createPhotoHandler(config, debouncer, ctxMap));
  bot.on("message:document", createDocumentHandler(config, debouncer, ctxMap));

  // Scheduler
  function getForumChatId(): number | null {
    const ids = forumChats.allIds();
    return ids.length > 0 ? ids[0] : null;
  }

  async function deliver(to: string, text: string) {
    if (to === "dm") { await bot.api.sendMessage(config.telegramUserId, text); return; }
    if (to.startsWith("topic:")) {
      const forumChatId = getForumChatId();
      if (forumChatId) {
        const topicName = to.slice(6);
        const tid = await getOrCreateTopic(bot.api, topicRepo, forumChatId, topicName);
        const opts: any = {};
        if (tid && tid !== 1) opts.message_thread_id = tid;
        await bot.api.sendMessage(forumChatId, text, opts);
        return;
      }
    }
    await bot.api.sendMessage(config.telegramUserId, text);
  }

  const scheduler = new Scheduler(config, db, deliver);
  scheduler.start();

  console.log("Kuzma starting...");
  bot.start({
    onStart: async (botInfo) => {
      console.log(`Bot @${botInfo.username} is running`);
      try { await bot.api.sendMessage(config.telegramUserId, persona?.replies.startup ?? DEFAULT_PERSONA.replies.startup); } catch {}
    },
  });

  startWatchdog();

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("Shutting down...");
    try { await bot.api.sendMessage(config.telegramUserId, persona?.replies.shutdown ?? DEFAULT_PERSONA.replies.shutdown); } catch {}
    scheduler.stop();
    bot.stop();
    db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (e) => console.error("Unhandled:", e));
}

main().catch(console.error);
