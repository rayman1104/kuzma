import { test, expect, describe } from "bun:test";
import { buildPrompt } from "./context-builder";

function fakeCtx(overrides: any = {}): any {
  return {
    message: {
      reply_to_message: undefined,
      forward_origin: undefined,
      ...overrides,
    },
  };
}

describe("buildPrompt", () => {
  test("plain text — no context", () => {
    const ctx = fakeCtx();
    expect(buildPrompt(ctx, "hello")).toBe("hello");
  });

  test("reply-to text message", () => {
    const ctx = fakeCtx({
      reply_to_message: { text: "original message" },
    });
    expect(buildPrompt(ctx, "my reply")).toBe(
      '[Replying to: "original message"]\nmy reply'
    );
  });

  test("reply-to caption (photo/video)", () => {
    const ctx = fakeCtx({
      reply_to_message: { caption: "photo caption" },
    });
    expect(buildPrompt(ctx, "nice pic")).toBe(
      '[Replying to: "photo caption"]\nnice pic'
    );
  });

  test("truncates long reply text to 200 chars", () => {
    const long = "a".repeat(250);
    const ctx = fakeCtx({
      reply_to_message: { text: long },
    });
    const result = buildPrompt(ctx, "wow");
    const quoted = result.split("\n")[0];
    // 200 chars + ellipsis inside quotes + prefix
    expect(quoted).toBe(`[Replying to: "${"a".repeat(200)}…"]`);
  });

  test("forward from user", () => {
    const ctx = fakeCtx({
      forward_origin: {
        type: "user",
        sender_user: { first_name: "John", last_name: "Doe" },
      },
    });
    expect(buildPrompt(ctx, "forwarded text")).toBe(
      "[Forwarded from: John Doe]\nforwarded text"
    );
  });

  test("forward from hidden user", () => {
    const ctx = fakeCtx({
      forward_origin: {
        type: "hidden_user",
        sender_user_name: "Anonymous",
      },
    });
    expect(buildPrompt(ctx, "secret")).toBe(
      "[Forwarded from: Anonymous]\nsecret"
    );
  });

  test("forward from chat", () => {
    const ctx = fakeCtx({
      forward_origin: {
        type: "chat",
        sender_chat: { title: "My Group" },
      },
    });
    expect(buildPrompt(ctx, "group msg")).toBe(
      "[Forwarded from: My Group]\ngroup msg"
    );
  });

  test("forward from channel", () => {
    const ctx = fakeCtx({
      forward_origin: {
        type: "channel",
        chat: { title: "News Channel" },
      },
    });
    expect(buildPrompt(ctx, "news")).toBe(
      "[Forwarded from: News Channel]\nnews"
    );
  });

  test("combined: forward + reply", () => {
    const ctx = fakeCtx({
      forward_origin: {
        type: "user",
        sender_user: { first_name: "Alice" },
      },
      reply_to_message: { text: "previous msg" },
    });
    const result = buildPrompt(ctx, "response");
    expect(result).toBe(
      '[Forwarded from: Alice]\n[Replying to: "previous msg"]\nresponse'
    );
  });

  test("no message on context — returns plain text", () => {
    const ctx = { message: undefined } as any;
    expect(buildPrompt(ctx, "bare")).toBe("bare");
  });
});
