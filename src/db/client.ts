import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { mkdirSync } from "fs";
import { dirname } from "path";

export function createDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  initSchema(db);
  return db;
}

export class SessionRepo {
  constructor(private db: Database) {}

  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT session_id FROM sessions WHERE key = ?")
      .get(key) as { session_id: string } | null;
    return row?.session_id ?? null;
  }

  upsert(key: string, sessionId: string): void {
    this.db.prepare(
      `INSERT INTO sessions (key, session_id, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`
    ).run(key, sessionId);
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM sessions WHERE key = ?").run(key);
  }
}

export class TopicRepo {
  constructor(private db: Database) {}

  upsert(name: string, threadId: number, chatId: number): void {
    this.db.prepare(
      `INSERT INTO topic_mappings (name, thread_id, chat_id) VALUES (?, ?, ?)
       ON CONFLICT(name, chat_id) DO UPDATE SET thread_id = excluded.thread_id`
    ).run(name, threadId, chatId);
  }

  getThreadId(name: string, chatId: number): number | null {
    const row = this.db
      .prepare("SELECT thread_id FROM topic_mappings WHERE name = ? AND chat_id = ?")
      .get(name, chatId) as { thread_id: number } | null;
    return row?.thread_id ?? null;
  }

  getName(threadId: number, chatId: number): string | null {
    const row = this.db
      .prepare("SELECT name FROM topic_mappings WHERE thread_id = ? AND chat_id = ?")
      .get(threadId, chatId) as { name: string } | null;
    return row?.name ?? null;
  }

  all(chatId: number): Array<{ name: string; thread_id: number }> {
    return this.db
      .prepare("SELECT name, thread_id FROM topic_mappings WHERE chat_id = ?")
      .all(chatId) as Array<{ name: string; thread_id: number }>;
  }
}
