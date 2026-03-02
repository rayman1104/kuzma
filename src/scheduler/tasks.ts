import type { Database } from "bun:sqlite";

export interface ScheduledTask {
  id: string; what: string; schedule: string;
  until_condition?: string | null; urgency: "low" | "medium" | "high" | "critical";
  deliver_to: string; quiet_start?: string | null; quiet_end?: string | null;
  quiet_action?: "skip" | "queue"; status: "active" | "paused" | "completed";
  created_at?: string; last_run_at?: string | null; next_run_at?: string | null;
}

type CreateInput = Pick<ScheduledTask, "id" | "what" | "schedule" | "urgency" | "deliver_to" | "status"> & Partial<ScheduledTask>;

export class TaskRepo {
  constructor(private db: Database) {}

  create(t: CreateInput): void {
    this.db.prepare(
      `INSERT INTO tasks (id,what,schedule,until_condition,urgency,deliver_to,quiet_start,quiet_end,quiet_action,status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(t.id, t.what, t.schedule, t.until_condition ?? null, t.urgency, t.deliver_to,
      t.quiet_start ?? null, t.quiet_end ?? null, t.quiet_action ?? "queue", t.status);
  }

  get(id: string): ScheduledTask | null {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as ScheduledTask | null;
  }

  listActive(): ScheduledTask[] {
    return this.db.prepare("SELECT * FROM tasks WHERE status = 'active'").all() as ScheduledTask[];
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  }

  markRun(id: string): void {
    this.db.prepare("UPDATE tasks SET last_run_at = datetime('now') WHERE id = ?").run(id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }
}
