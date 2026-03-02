#!/usr/bin/env bun
// CLI for managing Kuzma scheduled tasks.
// Usage:
//   bun scripts/task-cli.ts add --what "Drink water" --schedule "0 */2 * * *" --deliver dm
//   bun scripts/task-cli.ts list
//   bun scripts/task-cli.ts delete <id>
import Database from "bun:sqlite";
import { randomUUID } from "crypto";

const DB_PATH = process.env.DB_PATH || "/Users/malakhov/code/kuzma2/data/kuzma.db";
const db = new Database(DB_PATH);

const [, , command, ...rest] = process.argv;

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--") && i + 1 < args.length) {
      result[args[i].slice(2)] = args[i + 1];
      i++;
    }
  }
  return result;
}

if (command === "add") {
  const a = parseArgs(rest);
  if (!a.what || !a.schedule) {
    console.error("Required: --what <text> --schedule <cron>");
    process.exit(1);
  }
  const id = randomUUID().slice(0, 8);
  db.prepare(
    `INSERT INTO tasks (id,what,schedule,until_condition,urgency,deliver_to,quiet_start,quiet_end,quiet_action,status)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, a.what, a.schedule, a.until || null,
    a.urgency || "medium", a.deliver || "dm",
    a["quiet-start"] || null, a["quiet-end"] || null,
    a["quiet-action"] || "queue", "active"
  );
  console.log(`Created task ${id}: "${a.what}" [${a.schedule}]`);
} else if (command === "list") {
  const tasks = db.prepare("SELECT * FROM tasks WHERE status = 'active'").all() as any[];
  if (!tasks.length) { console.log("No active tasks."); }
  else {
    for (const t of tasks) {
      console.log(`${t.id} | ${t.what} | ${t.schedule} | ${t.urgency} → ${t.deliver_to}`);
    }
  }
} else if (command === "delete") {
  const id = rest[0];
  if (!id) { console.error("Usage: delete <id>"); process.exit(1); }
  db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  console.log(`Deleted task ${id}`);
} else {
  console.log("Usage: task-cli.ts <add|list|delete> [options]");
  console.log("  add --what <text> --schedule <cron> [--deliver dm|topic:<name>] [--urgency low|medium|high|critical] [--until <condition>]");
  console.log("  list");
  console.log("  delete <id>");
}

db.close();
