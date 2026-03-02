import { resolve } from "path";
import { homedir } from "os";

export interface Config {
  telegramBotToken: string;
  telegramUserId: number;
  parakeetUrl: string;
  vaultPath: string;
  workspacePath: string;
  dbPath: string;
  askUserBridgePort: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

export function getConfig(): Config {
  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramUserId: Number(required("TELEGRAM_USER_ID")),
    parakeetUrl: process.env.PARAKEET_URL || "http://localhost:5092",
    vaultPath: expandHome(process.env.VAULT_PATH || "~/vault"),
    workspacePath: expandHome(process.env.WORKSPACE_PATH || "~/workspace"),
    dbPath: process.env.DB_PATH || "./data/kuzma.db",
    askUserBridgePort: Number(process.env.ASK_USER_BRIDGE_PORT || "3847"),
  };
}
