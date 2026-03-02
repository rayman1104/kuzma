export interface AskRequest { requestId: string; question: string; options?: string[]; }

export class AskUserBridge {
  private pending = new Map<string, (answer: string) => void>();

  waitForAnswer(id: string): Promise<string> {
    return new Promise((resolve) => this.pending.set(id, resolve));
  }

  resolve(id: string, answer: string): boolean {
    const r = this.pending.get(id);
    if (!r) return false;
    this.pending.delete(id);
    r(answer);
    return true;
  }

  startServer(port: number, onQuestion: (req: AskRequest) => Promise<void>): void {
    Bun.serve({
      port,
      fetch: async (req) => {
        if (req.method !== "POST" || new URL(req.url).pathname !== "/ask")
          return new Response("Not found", { status: 404 });
        const body = (await req.json()) as AskRequest;
        await onQuestion(body);
        const answer = await this.waitForAnswer(body.requestId);
        return Response.json({ answer });
      },
    });
  }
}
