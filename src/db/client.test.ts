import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { SessionRepo, TopicRepo } from "./client";

describe("SessionRepo", () => {
  let db: Database;
  let repo: SessionRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    repo = new SessionRepo(db);
  });

  test("upsert and get", () => {
    repo.upsert("123:dm", "session-abc");
    expect(repo.get("123:dm")).toBe("session-abc");
  });

  test("upsert overwrites", () => {
    repo.upsert("123:dm", "old");
    repo.upsert("123:dm", "new");
    expect(repo.get("123:dm")).toBe("new");
  });

  test("get returns null for missing key", () => {
    expect(repo.get("unknown")).toBeNull();
  });
});

describe("TopicRepo", () => {
  let db: Database;
  let repo: TopicRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    repo = new TopicRepo(db);
  });

  test("upsert and getThreadId", () => {
    repo.upsert("job-search", 42, -100123);
    expect(repo.getThreadId("job-search", -100123)).toBe(42);
  });

  test("getName by threadId", () => {
    repo.upsert("job-search", 42, -100123);
    expect(repo.getName(42, -100123)).toBe("job-search");
  });
});
