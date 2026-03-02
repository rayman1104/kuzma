#!/usr/bin/env bun
/**
 * kuzma setup — interactive .env configuration
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";

const ENV_PATH = ".env";
const ENV_EXAMPLE_PATH = ".env.example";

console.log("\n🔧 Kuzma Setup\n");

function prompt(question: string, defaultValue?: string): string {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  process.stdout.write(`${question}${suffix}: `);

  // Read line from stdin synchronously
  const buf = Buffer.alloc(1024);
  const fd = require("fs").openSync("/dev/stdin", "rs");
  let input = "";
  while (true) {
    const bytesRead = require("fs").readSync(fd, buf, 0, 1, null);
    if (bytesRead === 0) break;
    const char = buf.toString("utf-8", 0, bytesRead);
    if (char === "\n") break;
    input += char;
  }
  require("fs").closeSync(fd);

  return input.trim() || defaultValue || "";
}

// Check if .env already exists
if (existsSync(ENV_PATH)) {
  const overwrite = prompt(".env already exists. Overwrite? (y/N)", "N");
  if (overwrite.toLowerCase() !== "y") {
    console.log("Keeping existing .env. Done.");
    process.exit(0);
  }
}

console.log("Let's configure your bot.\n");

const botToken = prompt("Telegram bot token (from @BotFather)");
if (!botToken) {
  console.error("Bot token is required. Get one from https://t.me/BotFather");
  process.exit(1);
}

const userId = prompt("Your Telegram user ID (from @userinfobot)");
if (!userId) {
  console.error("User ID is required. Get it from https://t.me/userinfobot");
  process.exit(1);
}

const parakeetUrl = prompt("Parakeet STT URL", "http://localhost:5092");

console.log("\nOptional paths (press Enter for defaults):");
const vaultPath = prompt("Vault path", "~/vault");
const workspacePath = prompt("Workspace path", "~/workspace");
const dbPath = prompt("Database path", "./data/kuzma.db");

// Build .env content
const env = [
  `TELEGRAM_BOT_TOKEN=${botToken}`,
  `TELEGRAM_USER_ID=${userId}`,
  `PARAKEET_URL=${parakeetUrl}`,
  `VAULT_PATH=${vaultPath}`,
  `WORKSPACE_PATH=${workspacePath}`,
  `DB_PATH=${dbPath}`,
].join("\n") + "\n";

// Ensure data directory exists
mkdirSync("data", { recursive: true });

writeFileSync(ENV_PATH, env);
console.log(`\n✓ Saved ${ENV_PATH}`);

// Validate bot token
console.log("\nValidating bot token...");
try {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const data = await resp.json() as any;
  if (data.ok) {
    console.log(`✓ Bot: @${data.result.username} (${data.result.first_name})`);
  } else {
    console.log(`✗ Invalid token: ${data.description}`);
  }
} catch (err) {
  console.log("✗ Could not validate token (network error)");
}

console.log("\nSetup complete! Run: bun run start");
console.log("On first start, the bot will ask you to set up its personality in Telegram.\n");
