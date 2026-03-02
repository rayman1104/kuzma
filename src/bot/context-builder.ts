import type { Context } from "grammy";

const MAX_QUOTE_LENGTH = 200;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "…";
}

function getReplyText(ctx: Context): string | undefined {
  const reply = ctx.message?.reply_to_message;
  if (!reply) return undefined;
  return reply.text ?? reply.caption;
}

function getForwardName(ctx: Context): string | undefined {
  const origin = ctx.message?.forward_origin;
  if (!origin) return undefined;

  switch (origin.type) {
    case "user":
      return [origin.sender_user.first_name, origin.sender_user.last_name]
        .filter(Boolean)
        .join(" ");
    case "hidden_user":
      return origin.sender_user_name;
    case "chat":
      return (origin.sender_chat as any).title ?? undefined;
    case "channel":
      return (origin.chat as any).title ?? undefined;
    default:
      return undefined;
  }
}

export function buildPrompt(ctx: Context, text: string): string {
  const parts: string[] = [];

  const forwardName = getForwardName(ctx);
  if (forwardName) {
    parts.push(`[Forwarded from: ${forwardName}]`);
  }

  const replyText = getReplyText(ctx);
  if (replyText) {
    parts.push(`[Replying to: "${truncate(replyText, MAX_QUOTE_LENGTH)}"]`);
  }

  parts.push(text);
  return parts.join("\n");
}
