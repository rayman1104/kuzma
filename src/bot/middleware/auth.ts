import type { Context, NextFunction } from "grammy";

export function createAuthMiddleware(allowedUserId: number, forumChatIds?: Set<number>) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (ctx.from?.id === allowedUserId) return next();
    if (forumChatIds && ctx.chat && forumChatIds.has(ctx.chat.id)) return next();
    return;
  };
}
