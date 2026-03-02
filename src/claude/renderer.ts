import type { Api } from "grammy";
import type { KuzmaEvent } from "./events";

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

  constructor(
    private api: Api,
    private chatId: number,
    private threadId?: number // never pass 1 (General topic trap)
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
        break;
      case "error":
        await this.sendNew(`Error: ${event.message}`);
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

  private async doEdit(): Promise<void> {
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
  }

  private async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.accText.trim()) return;
    const chunks = splitMessage(this.accText);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0 && this.messageId) {
        try { await this.api.editMessageText(this.chatId, this.messageId, chunks[i]); }
        catch { await this.sendNew(chunks[i]); }
      } else {
        await this.sendNew(chunks[i]);
      }
    }
  }

  private async sendNew(text: string): Promise<void> {
    const opts: any = {};
    if (this.threadId) opts.message_thread_id = this.threadId;
    try {
      const sent = await this.api.sendMessage(this.chatId, text, opts);
      this.messageId = sent.message_id;
    } catch (err: any) {
      if (err?.description?.includes("message thread not found")) {
        const sent = await this.api.sendMessage(this.chatId, text);
        this.messageId = sent.message_id;
      }
    }
  }
}
