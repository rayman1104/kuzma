import type { Api } from "grammy";
import type { KuzmaEvent } from "./events";
import { markdownToTelegramHtml } from "./telegram-format";

const MAX_LEN = 4096;
const EDIT_THROTTLE_MS = 1000;

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_LEN) {
    let splitAt = remaining.lastIndexOf("\n\n", MAX_LEN);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf("\n", MAX_LEN);
    if (splitAt <= 0) splitAt = MAX_LEN;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class TelegramRenderer {
  private messageId: number | null = null;
  private accText = "";
  private lastEdit = 0;
  private timer: Timer | null = null;
  // Serializes all send/edit ops so the "create first message" check-and-set
  // (messageId) is atomic — otherwise concurrent doEdit/flush calls each see
  // messageId === null mid-await and send duplicate messages.
  private opChain: Promise<void> = Promise.resolve();

  private runExclusive(fn: () => Promise<void>): Promise<void> {
    const next = this.opChain.then(fn, fn);
    this.opChain = next;
    return next;
  }

  constructor(
    private api: Api,
    private chatId: number,
    private threadId?: number, // never pass 1 (General topic trap)
    private errorNotice = "Something went wrong, no answer came back."
  ) {
    if (threadId === 1) this.threadId = undefined;
  }

  async handleEvent(event: KuzmaEvent): Promise<void> {
    switch (event.type) {
      case "started":
      case "tool_use":
        await this.sendTyping();
        break;
      case "text":
        this.accText += event.content;
        await this.scheduleEdit();
        break;
      case "completed":
        await this.flush();
        // A failed run with no text at all would otherwise be complete silence.
        if (event.isError && !this.accText.trim()) {
          await this.runExclusive(() => this.sendNew(this.errorNotice));
        }
        break;
      case "error":
        await this.runExclusive(() => this.sendNew(`Error: ${event.message}`));
        break;
    }
  }

  private async sendTyping(): Promise<void> {
    try {
      const opts: any = {};
      if (this.threadId) opts.message_thread_id = this.threadId;
      await this.api.sendChatAction(this.chatId, "typing", opts);
    } catch {}
  }

  private async scheduleEdit(): Promise<void> {
    if (this.timer) return;
    const delay = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - this.lastEdit));
    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.doEdit();
    }, delay);
  }

  private doEdit(): Promise<void> {
    return this.runExclusive(async () => {
      if (!this.accText.trim()) return;
      const display = this.accText.slice(0, MAX_LEN);
      try {
        if (this.messageId) {
          await this.api.editMessageText(this.chatId, this.messageId, display);
        } else {
          const opts: any = {};
          if (this.threadId) opts.message_thread_id = this.threadId;
          const sent = await this.api.sendMessage(this.chatId, display, opts);
          this.messageId = sent.message_id;
        }
        this.lastEdit = Date.now();
      } catch {}
    });
  }

  private flush(): Promise<void> {
    // Cancel a not-yet-fired doEdit synchronously; an already-running doEdit is
    // serialized via runExclusive so flush waits for it (and sees its messageId).
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    return this.runExclusive(() => this.doFlush());
  }

  private async doFlush(): Promise<void> {
    if (!this.accText.trim()) return;

    const html = markdownToTelegramHtml(this.accText);
    const chunks = splitMessage(html);

    for (let i = 0; i < chunks.length; i++) {
      if (i === 0 && this.messageId) {
        try {
          await this.api.editMessageText(this.chatId, this.messageId, chunks[i], { parse_mode: "HTML" });
        } catch (err: any) {
          if (!err?.description?.includes("not modified")) {
            // HTML parse failed — retry without formatting
            try {
              await this.api.editMessageText(this.chatId, this.messageId, splitMessage(this.accText)[i]);
            } catch {
              await this.sendNew(chunks[i]);
            }
          }
        }
      } else {
        await this.sendNew(chunks[i], "HTML");
      }
    }
  }

  private async sendNew(text: string, parseMode?: string): Promise<void> {
    const opts: any = {};
    if (this.threadId) opts.message_thread_id = this.threadId;
    if (parseMode) opts.parse_mode = parseMode;
    try {
      const sent = await this.api.sendMessage(this.chatId, text, opts);
      this.messageId = sent.message_id;
    } catch (err: any) {
      if (parseMode && err?.description?.includes("can't parse entities")) {
        // Fallback: send without formatting
        delete opts.parse_mode;
        const sent = await this.api.sendMessage(this.chatId, this.accText.slice(0, MAX_LEN), opts);
        this.messageId = sent.message_id;
      } else if (err?.description?.includes("message thread not found")) {
        delete opts.message_thread_id;
        const sent = await this.api.sendMessage(this.chatId, text, opts);
        this.messageId = sent.message_id;
      }
    }
  }
}
