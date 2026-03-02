import { Cron } from "croner";
import PQueue from "p-queue";
import type { Config } from "../config";
import type { Database } from "bun:sqlite";
import { TaskRepo, type ScheduledTask } from "./tasks";
import { runClaude } from "../claude/runner";

export class Scheduler {
  private jobs = new Map<string, Cron>();
  private queue: PQueue;
  private repo: TaskRepo;

  constructor(
    private config: Config,
    db: Database,
    private deliverFn: (to: string, text: string) => Promise<void>
  ) {
    this.repo = new TaskRepo(db);
    this.queue = new PQueue({ concurrency: 1 });
  }

  async queueInteractive<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.add(fn, { priority: 10 }) as Promise<T>;
  }

  start(): void {
    const tasks = this.repo.listActive();
    for (const t of tasks) this.registerJob(t);
    console.log(`Scheduler: ${tasks.length} active tasks`);
  }

  registerJob(task: ScheduledTask): void {
    this.jobs.get(task.id)?.stop();
    const job = new Cron(task.schedule, {
      timezone: "Europe/Belgrade", protect: true,
    }, () => {
      this.queue.add(() => this.execute(task), { priority: 1 });
    });
    this.jobs.set(task.id, job);
  }

  private async execute(task: ScheduledTask): Promise<void> {
    const fresh = this.repo.get(task.id);
    if (!fresh || fresh.status !== "active") return;

    if (this.isQuiet(fresh) && fresh.quiet_action === "skip") return;

    const prompt = `Scheduled task: ${fresh.what}${
      fresh.until_condition ? `\nAuto-complete when: ${fresh.until_condition}\nIf condition met, start with "CONDITION_MET:"` : ""
    }\nExecute now and report status.`;

    let result = "";
    try {
      for await (const ev of runClaude({ prompt, workspacePath: this.config.workspacePath, timeoutMs: 180_000 })) {
        if (ev.type === "text") result += ev.content;
      }
    } catch (err) { result = `Error: ${err}`; }

    this.repo.markRun(task.id);

    if (fresh.until_condition && result.includes("CONDITION_MET:")) {
      this.repo.updateStatus(task.id, "completed");
      this.jobs.get(task.id)?.stop();
      this.jobs.delete(task.id);
    }

    await this.deliverFn(fresh.deliver_to, result);
  }

  private isQuiet(t: ScheduledTask): boolean {
    if (!t.quiet_start || !t.quiet_end || t.urgency === "critical") return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sH, sM] = t.quiet_start.split(":").map(Number);
    const [eH, eM] = t.quiet_end.split(":").map(Number);
    const start = sH * 60 + sM, end = eH * 60 + eM;
    return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
  }

  stop(): void { for (const j of this.jobs.values()) j.stop(); this.jobs.clear(); }
}
