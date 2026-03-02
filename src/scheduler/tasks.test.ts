import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../db/schema";
import { TaskRepo } from "./tasks";

describe("TaskRepo", () => {
  let repo: TaskRepo;
  beforeEach(() => {
    const db = new Database(":memory:");
    initSchema(db);
    repo = new TaskRepo(db);
  });

  test("create and get", () => {
    repo.create({ id: "t1", what: "Check Gmail", schedule: "0 */2 * * *", urgency: "high", deliver_to: "dm", status: "active" });
    expect(repo.get("t1")!.what).toBe("Check Gmail");
  });

  test("listActive", () => {
    repo.create({ id: "t1", what: "A", schedule: "* * * * *", urgency: "low", deliver_to: "dm", status: "active" });
    repo.create({ id: "t2", what: "B", schedule: "* * * * *", urgency: "low", deliver_to: "dm", status: "completed" });
    expect(repo.listActive().length).toBe(1);
  });

  test("updateStatus", () => {
    repo.create({ id: "t1", what: "A", schedule: "* * * * *", urgency: "low", deliver_to: "dm", status: "active" });
    repo.updateStatus("t1", "completed");
    expect(repo.get("t1")!.status).toBe("completed");
  });
});
