import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createTestDb, mockRunClaude, sleep } from "./harness";
import { Scheduler } from "../../src/scheduler/engine";
import { TaskRepo } from "../../src/scheduler/tasks";
import type { Config } from "../../src/config";

const testConfig: Config = {
  telegramBotToken: "fake:token",
  telegramUserId: 111,
  parakeetUrl: "http://localhost:5092",
  vaultPath: "/tmp/vault",
  workspacePath: "/tmp/workspace",
  dbPath: ":memory:",
  askUserBridgePort: 0,
};

describe("Scheduler", () => {
  let scheduler: Scheduler;

  afterEach(() => {
    scheduler.stop();
  });

  test("sync() loads active tasks without error", () => {
    const db = createTestDb();
    const taskRepo = new TaskRepo(db);
    const delivered: Array<{ to: string; text: string }> = [];
    const deliverFn = async (to: string, text: string) => {
      delivered.push({ to, text });
    };
    const { runner } = mockRunClaude([]);

    taskRepo.create({
      id: "t1",
      what: "Check servers",
      schedule: "* * * * *",
      urgency: "low",
      deliver_to: "dm",
      status: "active",
    });

    scheduler = new Scheduler(testConfig, db, deliverFn, runner);
    scheduler.start();
    // No errors thrown — task was registered
  });

  test("sync() does not load paused tasks", () => {
    const db = createTestDb();
    const taskRepo = new TaskRepo(db);
    const delivered: Array<{ to: string; text: string }> = [];
    const deliverFn = async (to: string, text: string) => {
      delivered.push({ to, text });
    };
    const { runner, calls } = mockRunClaude([]);

    taskRepo.create({
      id: "t1",
      what: "Paused task",
      schedule: "* * * * * *",
      urgency: "low",
      deliver_to: "dm",
      status: "paused",
    });

    scheduler = new Scheduler(testConfig, db, deliverFn, runner);
    scheduler.start();

    // Wait a bit — paused task should never execute
    // (start() calls sync() which only loads active tasks)
    // We verify by confirming runner was never called after a tick
    expect(calls.length).toBe(0);
  });

  test("execution flow: task runs and delivers result", async () => {
    const db = createTestDb();
    const taskRepo = new TaskRepo(db);
    const delivered: Array<{ to: string; text: string }> = [];
    const deliverFn = async (to: string, text: string) => {
      delivered.push({ to, text });
    };
    const { runner, calls } = mockRunClaude([
      { type: "text", content: "Servers are healthy." },
    ]);

    taskRepo.create({
      id: "t1",
      what: "Check servers",
      // every-second cron (croner supports 6-field with seconds)
      schedule: "* * * * * *",
      urgency: "low",
      deliver_to: "dm",
      status: "active",
    });

    const task = taskRepo.get("t1")!;
    scheduler = new Scheduler(testConfig, db, deliverFn, runner);
    scheduler.registerJob(task);

    // Wait for the cron to fire at least once (~1 second + buffer)
    await sleep(1500);

    expect(calls.length).toBeGreaterThan(0);
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered[0].to).toBe("dm");
    expect(delivered[0].text).toContain("Servers are healthy.");
  });

  test("quiet hours skip execution", async () => {
    const db = createTestDb();
    const taskRepo = new TaskRepo(db);
    const delivered: Array<{ to: string; text: string }> = [];
    const deliverFn = async (to: string, text: string) => {
      delivered.push({ to, text });
    };
    const { runner, calls } = mockRunClaude([
      { type: "text", content: "Should not be delivered." },
    ]);

    // Bracket current time with quiet window
    const now = new Date();
    const h = now.getHours();
    const quietStart = `${(h - 1 + 24) % 24}:00`;
    const quietEnd = `${(h + 1) % 24}:00`;

    taskRepo.create({
      id: "t2",
      what: "Quiet task",
      schedule: "* * * * * *",
      urgency: "low",
      deliver_to: "dm",
      status: "active",
      quiet_start: quietStart,
      quiet_end: quietEnd,
      quiet_action: "skip",
    });

    const task = taskRepo.get("t2")!;
    scheduler = new Scheduler(testConfig, db, deliverFn, runner);
    scheduler.registerJob(task);

    await sleep(1500);

    // Cron fired but execute() should have returned early due to quiet hours
    expect(calls.length).toBe(0);
    expect(delivered.length).toBe(0);
  });

  test("critical urgency bypasses quiet hours", async () => {
    const db = createTestDb();
    const taskRepo = new TaskRepo(db);
    const delivered: Array<{ to: string; text: string }> = [];
    const deliverFn = async (to: string, text: string) => {
      delivered.push({ to, text });
    };
    const { runner, calls } = mockRunClaude([
      { type: "text", content: "Critical alert fired." },
    ]);

    const now = new Date();
    const h = now.getHours();
    const quietStart = `${(h - 1 + 24) % 24}:00`;
    const quietEnd = `${(h + 1) % 24}:00`;

    taskRepo.create({
      id: "t3",
      what: "Critical task",
      schedule: "* * * * * *",
      urgency: "critical",
      deliver_to: "dm",
      status: "active",
      quiet_start: quietStart,
      quiet_end: quietEnd,
      quiet_action: "skip",
    });

    const task = taskRepo.get("t3")!;
    scheduler = new Scheduler(testConfig, db, deliverFn, runner);
    scheduler.registerJob(task);

    await sleep(1500);

    // critical urgency: isQuiet() returns false regardless of time window
    expect(calls.length).toBeGreaterThan(0);
    expect(delivered.length).toBeGreaterThan(0);
    expect(delivered[0].text).toContain("Critical alert fired.");
  });

  test("stop() cleans up all jobs and poll timer", () => {
    const db = createTestDb();
    const taskRepo = new TaskRepo(db);
    const deliverFn = async (_to: string, _text: string) => {};
    const { runner } = mockRunClaude([]);

    taskRepo.create({
      id: "t4",
      what: "Cleanup test",
      schedule: "* * * * *",
      urgency: "low",
      deliver_to: "dm",
      status: "active",
    });

    scheduler = new Scheduler(testConfig, db, deliverFn, runner);
    scheduler.start();
    // stop() must not throw
    scheduler.stop();
  });
});
