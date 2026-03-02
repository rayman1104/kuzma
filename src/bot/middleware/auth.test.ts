import { describe, test, expect } from "bun:test";
import { createAuthMiddleware } from "./auth";

describe("auth middleware", () => {
  const mw = createAuthMiddleware(12345);

  test("allows authorized user", async () => {
    let called = false;
    await mw({ from: { id: 12345 } } as any, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("blocks unauthorized user", async () => {
    let called = false;
    await mw({ from: { id: 99999 } } as any, async () => { called = true; });
    expect(called).toBe(false);
  });

  test("blocks no from", async () => {
    let called = false;
    await mw({ from: undefined } as any, async () => { called = true; });
    expect(called).toBe(false);
  });
});
