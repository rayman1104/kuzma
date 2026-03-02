import { describe, test, expect } from "bun:test";
import { Debouncer } from "./debounce";

describe("Debouncer", () => {
  test("fires after delay", async () => {
    const results: string[] = [];
    const d = new Debouncer(50, 500, (_k, t) => results.push(t));
    d.add("k", "hello");
    expect(results).toEqual([]);
    await Bun.sleep(100);
    expect(results).toEqual(["hello"]);
  });

  test("concatenates within window", async () => {
    const results: string[] = [];
    const d = new Debouncer(100, 500, (_k, t) => results.push(t));
    d.add("k", "a");
    await Bun.sleep(30);
    d.add("k", "b");
    await Bun.sleep(150);
    expect(results).toEqual(["a\nb"]);
  });

  test("independent keys", async () => {
    const results: string[] = [];
    const d = new Debouncer(50, 500, (_k, t) => results.push(t));
    d.add("a", "1");
    d.add("b", "2");
    await Bun.sleep(100);
    expect(results).toContain("1");
    expect(results).toContain("2");
  });
});
