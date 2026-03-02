import { describe, test, expect } from "bun:test";
import { splitMessage } from "./renderer";

describe("splitMessage", () => {
  test("short returns single chunk", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  test("splits at paragraph boundary", () => {
    const a = "A".repeat(4000);
    const b = "B".repeat(100);
    const chunks = splitMessage(`${a}\n\n${b}`);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b);
  });

  test("hard splits when no boundary", () => {
    const text = "X".repeat(5000);
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(4096);
  });
});
