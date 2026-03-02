import { describe, test, expect } from "bun:test";
import { createAuthMiddleware } from "./auth";

describe("auth middleware", () => {
  test("allows authorized user in DM", async () => {
    const mw = createAuthMiddleware(12345);
    let called = false;
    await mw({ from: { id: 12345 } } as any, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("blocks unauthorized user in DM", async () => {
    const mw = createAuthMiddleware(12345);
    let called = false;
    await mw({ from: { id: 99999 } } as any, async () => { called = true; });
    expect(called).toBe(false);
  });

  test("blocks no from", async () => {
    const mw = createAuthMiddleware(12345);
    let called = false;
    await mw({ from: undefined } as any, async () => { called = true; });
    expect(called).toBe(false);
  });

  test("allows message from registered forum chat", async () => {
    const forumChatIds = new Set([-1001234]);
    const mw = createAuthMiddleware(12345, forumChatIds);
    let called = false;
    const ctx = { from: { id: 99999 }, chat: { id: -1001234 } } as any;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("blocks message from unregistered group", async () => {
    const forumChatIds = new Set([-1001234]);
    const mw = createAuthMiddleware(12345, forumChatIds);
    let called = false;
    const ctx = { from: { id: 99999 }, chat: { id: -1009999 } } as any;
    await mw(ctx, async () => { called = true; });
    expect(called).toBe(false);
  });
});
