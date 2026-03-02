export type DebouncerCallback = (key: string, combinedText: string) => void;

interface Entry { messages: string[]; timer: Timer; lastFired?: string; lastFiredAt?: number; }

export class Debouncer {
  private pending = new Map<string, Entry>();

  constructor(
    private windowMs: number,
    private extendedMs: number,
    private onFire: DebouncerCallback
  ) {}

  add(key: string, text: string): void {
    const isAppend = text.startsWith("+");
    const clean = isAppend ? text.slice(1).trimStart() : text;
    const existing = this.pending.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(clean);
      existing.timer = setTimeout(() => this.fire(key), this.windowMs);
      return;
    }

    // Check ghost for "+" append to recently fired
    if (isAppend) {
      const ghost = this.pending.get(`_g:${key}`);
      if (ghost?.lastFiredAt && Date.now() - ghost.lastFiredAt < this.extendedMs) {
        this.pending.delete(`_g:${key}`);
        const entry: Entry = {
          messages: [ghost.lastFired!, clean],
          timer: setTimeout(() => this.fire(key), this.windowMs),
        };
        this.pending.set(key, entry);
        return;
      }
    }

    this.pending.set(key, {
      messages: [clean],
      timer: setTimeout(() => this.fire(key), this.windowMs),
    });
  }

  private fire(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    const combined = entry.messages.join("\n");
    this.pending.delete(key);
    // Ghost for "+" append
    this.pending.set(`_g:${key}`, {
      messages: [],
      timer: setTimeout(() => this.pending.delete(`_g:${key}`), this.extendedMs),
      lastFired: combined,
      lastFiredAt: Date.now(),
    });
    this.onFire(key, combined);
  }

  cancel(key: string): void {
    const e = this.pending.get(key);
    if (e) { clearTimeout(e.timer); this.pending.delete(key); }
  }
}
