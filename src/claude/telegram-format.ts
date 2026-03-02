/**
 * Converts Claude's Markdown output to Telegram-compatible HTML.
 * Handles: bold, italic, strikethrough, code, headers, tables→lists.
 * Escapes all HTML entities in non-formatted text.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Convert markdown table block into compact "key: value" lines */
function convertTables(text: string): string {
  return text.replace(
    /(?:^\|.+\|$\n?)+/gm,
    (block) => {
      const rows = block
        .trim()
        .split("\n")
        .filter((r) => !/^\|[\s\-:|]+\|$/.test(r)) // skip separator
        .map((r) =>
          r
            .split("|")
            .slice(1, -1)
            .map((c) => c.trim()),
        );

      if (rows.length < 2) {
        // single row or empty — return as-is without pipes
        return rows.map((r) => r.join(" · ")).join("\n");
      }

      const headers = rows[0];
      return rows
        .slice(1)
        .map((row) =>
          row
            .map((cell, i) => (headers[i] ? `${headers[i]}: ${cell}` : cell))
            .join(" · "),
        )
        .join("\n");
    },
  );
}

export function markdownToTelegramHtml(md: string): string {
  let text = convertTables(md);

  // Extract fenced code blocks before escaping
  const codeBlocks: string[] = [];
  text = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, _lang, code) => {
    const i = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.trimEnd())}</pre>`);
    return `\x00CB${i}\x00`;
  });

  // Extract inline code
  const inlineCodes: string[] = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const i = inlineCodes.length;
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `\x00IC${i}\x00`;
  });

  // Escape HTML in remaining text
  text = escapeHtml(text);

  // Bold: **text**
  text = text.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *text* (not inside words)
  text = text.replace(/(?<!\w)\*(.+?)\*(?!\w)/g, "<i>$1</i>");

  // Strikethrough: ~~text~~
  text = text.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Headers → bold
  text = text.replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>");

  // Restore placeholders
  text = text.replace(/\x00CB(\d+)\x00/g, (_, i) => codeBlocks[+i]);
  text = text.replace(/\x00IC(\d+)\x00/g, (_, i) => inlineCodes[+i]);

  return text;
}
