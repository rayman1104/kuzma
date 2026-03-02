import type { Context, NextFunction } from "grammy";

export function createAuthMiddleware(allowedUserId: number) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (ctx.from?.id !== allowedUserId) return;
    await next();
  };
}
