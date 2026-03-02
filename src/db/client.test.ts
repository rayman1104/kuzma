import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { SessionRepo, TopicRepo, ForumChatRepo } from "./client";

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

describe("ForumChatRepo", () => {
  function makeDb() {
    const db = new Database(":memory:");
    initSchema(db);
    return db;
  }

  test("register and check forum chat", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    expect(repo.isRegistered(-1001234)).toBe(false);
    repo.register(-1001234);
    expect(repo.isRegistered(-1001234)).toBe(true);
  });

  test("register is idempotent", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    repo.register(-1001234);
    repo.register(-1001234);
    expect(repo.isRegistered(-1001234)).toBe(true);
  });

  test("unregister removes chat", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    repo.register(-1001234);
    repo.unregister(-1001234);
    expect(repo.isRegistered(-1001234)).toBe(false);
  });

  test("allIds returns all registered chats", () => {
    const db = makeDb();
    const repo = new ForumChatRepo(db);
    repo.register(-1001111);
    repo.register(-1002222);
    expect(repo.allIds().sort()).toEqual([-1002222, -1001111].sort());
  });
});
