import { test, expect, beforeEach, afterEach } from "bun:test";
import { loadPersona, savePersona, DEFAULT_PERSONA, type Persona } from "./persona";
import { unlinkSync, mkdirSync } from "fs";

const TEST_PATH = "./data/test-persona.json";

beforeEach(() => {
  mkdirSync("./data", { recursive: true });
  try { unlinkSync(TEST_PATH); } catch {}
});

afterEach(() => {
  try { unlinkSync(TEST_PATH); } catch {}
});

test("loadPersona returns null when file missing", () => {
  const persona = loadPersona("./data/nonexistent.json");
  expect(persona).toBeNull();
});

test("savePersona writes and loadPersona reads back", () => {
  const persona: Persona = {
    ...DEFAULT_PERSONA,
    name: "TestBot",
    language: "ru",
  };
  savePersona(TEST_PATH, persona);
  const loaded = loadPersona(TEST_PATH);
  expect(loaded).not.toBeNull();
  expect(loaded!.name).toBe("TestBot");
  expect(loaded!.language).toBe("ru");
  expect(loaded!.replies.startup).toBe(DEFAULT_PERSONA.replies.startup);
});

test("DEFAULT_PERSONA has all required reply keys", () => {
  const keys = ["startup", "shutdown", "error", "newSession", "stopped", "alreadyStopped", "voiceError", "photoError", "documentError"];
  for (const key of keys) {
    expect((DEFAULT_PERSONA.replies as any)[key]).toBeString();
  }
});
