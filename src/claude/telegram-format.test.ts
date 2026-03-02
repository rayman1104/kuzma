import { test, expect, describe } from "bun:test";
import { markdownToTelegramHtml } from "./telegram-format";

describe("markdownToTelegramHtml", () => {
  test("plain text — no changes except HTML escaping", () => {
    expect(markdownToTelegramHtml("hello world")).toBe("hello world");
    expect(markdownToTelegramHtml("a < b & c > d")).toBe(
      "a &lt; b &amp; c &gt; d",
    );
  });

  test("bold **text**", () => {
    expect(markdownToTelegramHtml("**bold**")).toBe("<b>bold</b>");
    expect(markdownToTelegramHtml("a **b** c")).toBe("a <b>b</b> c");
  });

  test("italic *text*", () => {
    expect(markdownToTelegramHtml("*italic*")).toBe("<i>italic</i>");
  });

  test("strikethrough ~~text~~", () => {
    expect(markdownToTelegramHtml("~~strike~~")).toBe("<s>strike</s>");
  });

  test("headers → bold", () => {
    expect(markdownToTelegramHtml("## Section")).toBe("<b>Section</b>");
    expect(markdownToTelegramHtml("# Title")).toBe("<b>Title</b>");
  });

  test("inline code", () => {
    expect(markdownToTelegramHtml("use `bun test`")).toBe(
      "use <code>bun test</code>",
    );
  });

  test("inline code preserves HTML inside", () => {
    expect(markdownToTelegramHtml("`<div>`")).toBe(
      "<code>&lt;div&gt;</code>",
    );
  });

  test("fenced code block", () => {
    const input = "```ts\nconst x = 1;\n```";
    expect(markdownToTelegramHtml(input)).toBe(
      "<pre>const x = 1;</pre>",
    );
  });

  test("code block escapes HTML", () => {
    const input = "```\n<b>not bold</b>\n```";
    expect(markdownToTelegramHtml(input)).toBe(
      "<pre>&lt;b&gt;not bold&lt;/b&gt;</pre>",
    );
  });

  test("table → key: value lines", () => {
    const input = [
      "| Name | Price |",
      "|------|-------|",
      "| Apt A | 500€ |",
      "| Apt B | 700€ |",
    ].join("\n");
    expect(markdownToTelegramHtml(input)).toBe(
      "Name: Apt A · Price: 500€\nName: Apt B · Price: 700€",
    );
  });

  test("table without separator row", () => {
    const input = [
      "| Name | Price |",
      "| Apt A | 500€ |",
    ].join("\n");
    expect(markdownToTelegramHtml(input)).toBe(
      "Name: Apt A · Price: 500€",
    );
  });

  test("mixed content: bold inside table result", () => {
    const input = [
      "| Item | Cost |",
      "|------|------|",
      "| **TV** | 100€ |",
    ].join("\n");
    expect(markdownToTelegramHtml(input)).toBe(
      "Item: <b>TV</b> · Cost: 100€",
    );
  });

  test("combined: header, bold, list", () => {
    const input = "## Top picks\n- **Apt A** — 500€\n- **Apt B** — 700€";
    const expected =
      "<b>Top picks</b>\n- <b>Apt A</b> — 500€\n- <b>Apt B</b> — 700€";
    expect(markdownToTelegramHtml(input)).toBe(expected);
  });
});
