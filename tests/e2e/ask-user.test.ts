import { describe, test, expect } from "bun:test";
import {
  createTestBot,
  makeCallbackUpdate,
  callsFor,
  sleep,
} from "./harness";
import { AskUserBridge } from "../../src/bot/bridge";
import { setupCallbackHandler } from "../../src/bot/handlers/callback";
import { createAuthMiddleware } from "../../src/bot/middleware/auth";

const FAKE_BOT_INFO = {
  id: 999,
  is_bot: true as const,
  first_name: "TestBot",
  username: "test_bot",
  can_join_groups: true,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
};

let currentPort = 30000 + Math.floor(Math.random() * 5000);

function nextPort(): number {
  return currentPort++;
}

describe("ask-user bridge", () => {
  test("Full ask_user chain", async () => {
    const port = nextPort();
    const { bot, apiCalls } = createTestBot(111);
    bot.botInfo = FAKE_BOT_INFO;
    bot.use(createAuthMiddleware(111));

    const bridge = new AskUserBridge();
    const onQuestion = setupCallbackHandler(bot, bridge, 111);
    bridge.startServer(port, onQuestion);

    // Start the fetch — it will block until resolved
    const fetchPromise = fetch(`http://localhost:${port}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "req1", question: "Continue?", options: ["Yes", "No"] }),
    });

    // Let server process and send Telegram message
    await sleep(200);

    // Verify sendMessage was called with InlineKeyboard
    const sentMessages = callsFor(apiCalls, "sendMessage");
    expect(sentMessages.length).toBeGreaterThan(0);
    const lastMsg = sentMessages[sentMessages.length - 1];
    expect(lastMsg.payload.text).toBe("Continue?");
    expect(lastMsg.payload.reply_markup).toBeDefined();

    // Simulate user clicking "Yes" button
    await bot.handleUpdate(makeCallbackUpdate("ask:req1:Yes", 111, 111));

    // Now the fetch should resolve
    const res = await fetchPromise;
    expect(res.status).toBe(200);
    const data = await res.json() as { answer: string };
    expect(data.answer).toBe("Yes");

    // answerCallbackQuery should have been called with "Got it"
    const cbAnswers = callsFor(apiCalls, "answerCallbackQuery");
    expect(cbAnswers.length).toBeGreaterThan(0);
    expect(cbAnswers[cbAnswers.length - 1].payload.text).toBe("Got it");
  });

  test("Multiple options rendered as buttons", async () => {
    const port = nextPort();
    const { bot, apiCalls } = createTestBot(111);
    bot.botInfo = FAKE_BOT_INFO;
    bot.use(createAuthMiddleware(111));

    const bridge = new AskUserBridge();
    const onQuestion = setupCallbackHandler(bot, bridge, 111);
    bridge.startServer(port, onQuestion);

    const options = ["Option A", "Option B", "Option C"];

    const fetchPromise = fetch(`http://localhost:${port}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId: "req2", question: "Pick one:", options }),
    });

    await sleep(200);

    // Verify all three options appear in the reply_markup
    const sentMessages = callsFor(apiCalls, "sendMessage");
    expect(sentMessages.length).toBeGreaterThan(0);
    const lastMsg = sentMessages[sentMessages.length - 1];
    const replyMarkup = lastMsg.payload.reply_markup as any;
    expect(replyMarkup).toBeDefined();

    // InlineKeyboard serializes to { inline_keyboard: [[{text, callback_data}], ...] }
    const allButtons: { text: string; callback_data: string }[] =
      replyMarkup.inline_keyboard.flat();

    for (const opt of options) {
      const btn = allButtons.find(b => b.text === opt);
      expect(btn).toBeDefined();
      expect(btn!.callback_data).toBe(`ask:req2:${opt}`);
    }

    // Resolve with Option B
    await bot.handleUpdate(makeCallbackUpdate("ask:req2:Option B", 111, 111));

    const res = await fetchPromise;
    const data = await res.json() as { answer: string };
    expect(data.answer).toBe("Option B");
  });

  test("Expired request returns 'Expired' answer callback", async () => {
    const port = nextPort();
    const { bot, apiCalls } = createTestBot(111);
    bot.botInfo = FAKE_BOT_INFO;
    bot.use(createAuthMiddleware(111));

    const bridge = new AskUserBridge();
    const onQuestion = setupCallbackHandler(bot, bridge, 111);
    bridge.startServer(port, onQuestion);

    // Send callback_query for a requestId that was never registered
    await bot.handleUpdate(makeCallbackUpdate("ask:nonexistent:Yes", 111, 111));

    const cbAnswers = callsFor(apiCalls, "answerCallbackQuery");
    expect(cbAnswers.length).toBeGreaterThan(0);
    expect(cbAnswers[cbAnswers.length - 1].payload.text).toBe("Expired");
  });
});
