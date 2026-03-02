import { describe, test, expect, beforeEach } from "bun:test";
import { getConfig } from "./config";

describe("config", () => {
  beforeEach(() => {
    // Set defaults for optional vars
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_USER_ID = "12345";
  });

  test("getConfig returns all required fields", () => {
    const config = getConfig();
    expect(config.telegramBotToken).toBe("test-token");
    expect(config.telegramUserId).toBe(12345);
    expect(config.askUserBridgePort).toBe(3847);
  });

  test("throws on missing required var", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(() => getConfig()).toThrow("TELEGRAM_BOT_TOKEN");
  });
});
