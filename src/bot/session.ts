import type { Context } from "grammy";

export function getSessionKey(ctx: Context): string {
  const chatId = ctx.chat!.id;
  const msg = (ctx.message ?? ctx.callbackQuery?.message) as any;
  const threadId = msg?.message_thread_id as number | undefined;
  const isTopicMessage = msg?.is_topic_message;

  if (isTopicMessage && threadId) return `${chatId}:${threadId}`;
  if (ctx.chat && "is_forum" in ctx.chat && (ctx.chat as any).is_forum) return `${chatId}:general`;
  return `${chatId}:dm`;
}
