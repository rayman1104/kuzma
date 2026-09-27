import type { Api } from "grammy";

export const COMMANDS = [
  { command: "new", description: "Начать новую сессию — сбросить контекст в этом чате или топике" },
  { command: "stop", description: "Прервать запрос, который Клод сейчас выполняет" },
  { command: "tasks", description: "Показать активные запланированные задачи" },
  { command: "project", description: "Привязать топик к проекту: путь, clear или без аргумента" },
];

// Telegram clients build the "/" autocomplete in groups from the group scope and
// don't fall back to the default one, so register both.
export async function registerCommands(api: Api) {
  await api.setMyCommands(COMMANDS);
  await api.setMyCommands(COMMANDS, { scope: { type: "all_group_chats" } });
}
