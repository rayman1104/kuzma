/**
 * STT Live Runbook — E2E voice tests via Telegram MCP
 *
 * This file describes structured test cases for Claude Code to execute
 * against the running bot (@mlh_clawd_bot) using Telegram MCP tools.
 *
 * Prerequisites:
 *   - Bot is running and connected to Telegram
 *   - Parakeet STT is running (http://localhost:5092)
 *   - Telegram MCP tools are available (mcp__telegram__*)
 *   - Voice fixtures exist in tests/fixtures/voice/
 *
 * Execution:
 *   Run each test case sequentially using MCP tools as described.
 *   Wait for the specified delay between send and check.
 */

import { join } from "path";

const FIXTURES = join(import.meta.dir, "../fixtures/voice");
const BOT_USERNAME = "mlh_clawd_bot";
const WAIT_MS = 15_000; // time to wait for bot to process voice

// ─── Test Case Definitions ──────────────────────────────────────────────────

export interface TestCase {
  id: string;
  name: string;
  description: string;
  steps: string[];
  verify: string[];
}

export const preflight: TestCase = {
  id: "preflight",
  name: "Preflight Checks",
  description: "Verify prerequisites before running voice tests",
  steps: [
    `1. Resolve bot: mcp__telegram__resolve_username({ username: "${BOT_USERNAME}" })`,
    `2. Check Parakeet health: fetch("http://localhost:5092/v1/models")`,
    `3. Get baseline: mcp__telegram__get_messages({ chat: "${BOT_USERNAME}", limit: 5 })`,
    `4. Record baseline message count for later comparison`,
  ],
  verify: [
    "Bot username resolves successfully",
    "Parakeet returns 200 with model list",
    "Baseline message count recorded",
  ],
};

export const testCases: TestCase[] = [
  {
    id: "voice-hello-world",
    name: "Voice: Hello World",
    description: "Send hello-world.ogg, verify italic transcript + Claude response",
    steps: [
      `1. Send voice: mcp__telegram__send_voice({ chat: "${BOT_USERNAME}", file: "${join(FIXTURES, "hello-world.ogg")}" })`,
      `2. Wait ~${WAIT_MS / 1000}s for processing`,
      `3. Read messages: mcp__telegram__get_messages({ chat: "${BOT_USERNAME}", limit: 5 })`,
    ],
    verify: [
      'Bot sent an italic message (markdown _text_) containing "hello" and "world"',
      "A Claude response follows the transcript (non-italic text from bot)",
    ],
  },
  {
    id: "voice-numbers",
    name: "Voice: Numbers",
    description: "Send numbers.ogg, verify multi-word transcript accuracy",
    steps: [
      `1. Send voice: mcp__telegram__send_voice({ chat: "${BOT_USERNAME}", file: "${join(FIXTURES, "numbers.ogg")}" })`,
      `2. Wait ~${WAIT_MS / 1000}s for processing`,
      `3. Read messages: mcp__telegram__get_messages({ chat: "${BOT_USERNAME}", limit: 5 })`,
    ],
    verify: [
      'Bot sent italic transcript containing ≥3 of: "one", "two", "three", "four", "five"',
    ],
  },
  {
    id: "voice-silence",
    name: "Voice: Silence",
    description: "Send silence.ogg, verify bot doesn't crash",
    steps: [
      `1. Send voice: mcp__telegram__send_voice({ chat: "${BOT_USERNAME}", file: "${join(FIXTURES, "silence.ogg")}" })`,
      `2. Wait ~${WAIT_MS / 1000}s`,
      `3. Read messages: mcp__telegram__get_messages({ chat: "${BOT_USERNAME}", limit: 5 })`,
    ],
    verify: [
      "Bot does not crash (no error message or absence of response is acceptable)",
      "If transcript sent, it should be empty or near-empty",
    ],
  },
  {
    id: "voice-then-text",
    name: "Voice + Text Debounce",
    description: "Send voice followed by text within 2s debounce window, verify combined response",
    steps: [
      `1. Send voice: mcp__telegram__send_voice({ chat: "${BOT_USERNAME}", file: "${join(FIXTURES, "hello-world.ogg")}" })`,
      `2. Immediately send text: mcp__telegram__send_message({ chat: "${BOT_USERNAME}", text: "what did I just say?" })`,
      `3. Wait ~${WAIT_MS / 1000}s for processing`,
      `4. Read messages: mcp__telegram__get_messages({ chat: "${BOT_USERNAME}", limit: 10 })`,
    ],
    verify: [
      "Bot sent italic transcript for the voice message",
      'Claude response references both the voice content ("hello world") and the text question',
    ],
  },
  {
    id: "health-check",
    name: "Post-Test Health Check",
    description: "Send a text message after all voice tests to verify bot is still responsive",
    steps: [
      `1. Send text: mcp__telegram__send_message({ chat: "${BOT_USERNAME}", text: "ping" })`,
      `2. Wait ~10s`,
      `3. Read messages: mcp__telegram__get_messages({ chat: "${BOT_USERNAME}", limit: 3 })`,
    ],
    verify: [
      "Bot responds with a text message (not an error)",
      "Response arrives within reasonable time",
    ],
  },
];

// ─── Runner Summary ─────────────────────────────────────────────────────────

export const allTests = [preflight, ...testCases];

export function printRunbook(): void {
  console.log("=== STT Live Runbook ===\n");
  for (const tc of allTests) {
    console.log(`[${tc.id}] ${tc.name}`);
    console.log(`  ${tc.description}`);
    console.log("  Steps:");
    for (const s of tc.steps) console.log(`    ${s}`);
    console.log("  Verify:");
    for (const v of tc.verify) console.log(`    ✓ ${v}`);
    console.log();
  }
}

// Run directly: bun tests/e2e/stt-live-runbook.ts
if (import.meta.main) {
  printRunbook();
}
