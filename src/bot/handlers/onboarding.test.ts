import { test, expect } from "bun:test";
import { buildPersonaPrompt } from "./onboarding";

test("buildPersonaPrompt includes all user answers", () => {
  const prompt = buildPersonaPrompt({
    language: "English",
    name: "Buddy",
    personality: "casual, witty, slightly sarcastic",
    extra: "always sign off with a pun",
  });
  expect(prompt).toContain("English");
  expect(prompt).toContain("Buddy");
  expect(prompt).toContain("casual, witty, slightly sarcastic");
  expect(prompt).toContain("always sign off with a pun");
  expect(prompt).toContain('"replies"');
});

test("buildPersonaPrompt works without extra", () => {
  const prompt = buildPersonaPrompt({
    language: "Russian",
    name: "\u041A\u0443\u0437\u044C\u043C\u0430",
    personality: "friendly",
  });
  expect(prompt).toContain("Russian");
  expect(prompt).toContain("\u041A\u0443\u0437\u044C\u043C\u0430");
  expect(prompt).not.toContain("undefined");
});
