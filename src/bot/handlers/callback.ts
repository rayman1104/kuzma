import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { AskUserBridge, AskRequest } from "../bridge";

export function setupCallbackHandler(bot: Bot, bridge: AskUserBridge, chatId: number) {
  async function onQuestion(req: AskRequest): Promise<void> {
    const kb = new InlineKeyboard();
    if (req.options?.length) {
      for (const opt of req.options) kb.text(opt, `ask:${req.requestId}:${opt}`).row();
    } else {
      kb.text("OK", `ask:${req.requestId}:OK`);
    }
    await bot.api.sendMessage(chatId, req.question, { reply_markup: kb });
  }

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("ask:")) return;
    const [, requestId, ...rest] = data.split(":");
    const answer = rest.join(":");
    if (bridge.resolve(requestId, answer)) {
      await ctx.answerCallbackQuery({ text: "Got it" });
      try {
        const text = ctx.callbackQuery.message?.text ?? "";
        await ctx.editMessageText(`${text}\n\n> ${answer}`);
      } catch {}
    } else {
      await ctx.answerCallbackQuery({ text: "Expired" });
    }
  });

  return onQuestion;
}
