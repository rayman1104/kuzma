import type { Bot } from "grammy";
import type { ForumChatRepo } from "../../db/client";

export function setupJoinHandler(bot: Bot, forumChats: ForumChatRepo, forumChatIds: Set<number>) {
  bot.on("my_chat_member", (ctx) => {
    const chat = ctx.myChatMember.chat;
    if (chat.type !== "supergroup" || !(chat as any).is_forum) return;

    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "member" || status === "administrator") {
      forumChats.register(chat.id);
      forumChatIds.add(chat.id);
      console.log(`Forum registered: ${chat.id} ("${(chat as any).title}")`);
    } else if (status === "left" || status === "kicked") {
      forumChats.unregister(chat.id);
      forumChatIds.delete(chat.id);
      console.log(`Forum unregistered: ${chat.id}`);
    }
  });
}
