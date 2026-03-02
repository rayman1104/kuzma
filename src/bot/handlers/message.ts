import { resolve } from "path";
import type { Bot, Context } from "grammy";
import type { Config } from "../../config";
import { SessionRepo } from "../../db/client";
import { runClaude, type RunOptions } from "../../claude/runner";
import type { KuzmaEvent } from "../../claude/events";
import { TelegramRenderer } from "../../claude/renderer";
import { getSessionKey } from "../session";
import { Debouncer } from "../middleware/debounce";
import { buildPrompt } from "../context-builder";
import type { Database } from "bun:sqlite";
import { DEFAULT_PERSONA, type Persona } from "../../persona";

export type ClaudeRunner = (options: RunOptions) => AsyncGenerator<KuzmaEvent>;

export function setupMessageHandler(
  bot: Bot, config: Config, db: Database,
  claudeRunner: ClaudeRunner = runClaude,
  persona?: Persona,
) {
  const sessions = new SessionRepo(db);
  const activeAborts = new Map<string, AbortController>();
  const ctxMap = new Map<string, Context>();
  const queues = new Map<string, Promise<void>>();

  async function processWithClaude(ctx: Context, text: string): Promise<void> {
    const sessionKey = getSessionKey(ctx);
    const existingSession = sessions.get(sessionKey) ?? undefined;

    const ac = new AbortController();
    activeAborts.set(sessionKey, ac);

    const threadId = (ctx.message as any)?.message_thread_id as number | undefined;
    const renderer = new TelegramRenderer(ctx.api, ctx.chat!.id, threadId);

    try {
      for await (const event of claudeRunner({
        prompt: text,
        sessionId: existingSession,
        workspacePath: config.workspacePath,
        systemPromptPath: resolve(config.workspacePath, "CLAUDE.md"),
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
        try { await ctx.reply(persona?.replies.error ?? DEFAULT_PERSONA.replies.error); } catch {}
      }
    } finally {
      activeAborts.delete(sessionKey);
    }
  }

  function enqueue(key: string, fn: () => Promise<void>): void {
    const prev = queues.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    queues.set(key, next);
    next.finally(() => { if (queues.get(key) === next) queues.delete(key); });
  }

  const debouncer = new Debouncer(2000, 30000, (key, combined) => {
    const ctx = ctxMap.get(key);
    if (ctx) enqueue(key, () => processWithClaude(ctx, combined));
  });

  // Commands must be registered BEFORE the catch-all text handler
  bot.command("new", async (ctx) => {
    sessions.delete(getSessionKey(ctx));
    await ctx.reply(persona?.replies.newSession ?? DEFAULT_PERSONA.replies.newSession);
  });

  bot.command("stop", async (ctx) => {
    const key = getSessionKey(ctx);
    const ac = activeAborts.get(key);
    if (ac) { ac.abort(); await ctx.reply(persona?.replies.stopped ?? DEFAULT_PERSONA.replies.stopped); }
    else { await ctx.reply(persona?.replies.alreadyStopped ?? DEFAULT_PERSONA.replies.alreadyStopped); }
  });

  bot.on("message:text", (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;
    const key = getSessionKey(ctx);
    ctxMap.set(key, ctx);
    debouncer.add(key, buildPrompt(ctx, text));
  });

  return { debouncer, ctxMap, processWithClaude };
}
