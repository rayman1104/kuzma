import { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      what TEXT NOT NULL,
      schedule TEXT NOT NULL,
      until_condition TEXT,
      urgency TEXT NOT NULL DEFAULT 'low',
      deliver_to TEXT NOT NULL,
      quiet_start TEXT,
      quiet_end TEXT,
      quiet_action TEXT NOT NULL DEFAULT 'queue',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      next_run_at TEXT
    );
    CREATE TABLE IF NOT EXISTS topic_mappings (
      name TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      PRIMARY KEY (name, chat_id)
    );
    CREATE TABLE IF NOT EXISTS forum_chats (
      chat_id INTEGER PRIMARY KEY
    );
  `);
}
