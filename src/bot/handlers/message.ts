import type { Bot, Context } from "grammy";
import type { Config } from "../../config";
import { SessionRepo } from "../../db/client";
import { runClaude } from "../../claude/runner";
import { TelegramRenderer } from "../../claude/renderer";
import { getSessionKey } from "../session";
import type { Database } from "bun:sqlite";

export function setupMessageHandler(bot: Bot, config: Config, db: Database) {
  const sessions = new SessionRepo(db);
  const activeAborts = new Map<string, AbortController>();

  async function processWithClaude(ctx: Context, text: string): Promise<void> {
    const sessionKey = getSessionKey(ctx);
    const existingSession = sessions.get(sessionKey) ?? undefined;

    const prev = activeAborts.get(sessionKey);
    if (prev) prev.abort();

    const ac = new AbortController();
    activeAborts.set(sessionKey, ac);

    const threadId = (ctx.message as any)?.message_thread_id as number | undefined;
    const renderer = new TelegramRenderer(ctx.api, ctx.chat!.id, threadId);

    try {
      for await (const event of runClaude({
        prompt: text,
        sessionId: existingSession,
        workspacePath: config.workspacePath,
        abortSignal: ac.signal,
      })) {
        await renderer.handleEvent(event);
        if ((event.type === "started" || event.type === "completed") && event.sessionId) {
          sessions.upsert(sessionKey, event.sessionId);
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Runner error:", err);
        try { await ctx.reply("Something went wrong."); } catch {}
      }
    } finally {
      activeAborts.delete(sessionKey);
    }
  }

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;
    await processWithClaude(ctx, text);
  });

  bot.command("new", async (ctx) => {
    sessions.delete(getSessionKey(ctx));
    await ctx.reply("New session started.");
  });

  bot.command("stop", async (ctx) => {
    const key = getSessionKey(ctx);
    const ac = activeAborts.get(key);
    if (ac) { ac.abort(); await ctx.reply("Stopped."); }
    else { await ctx.reply("Nothing running."); }
  });

  return { processWithClaude };
}
