export interface AskRequest { requestId: string; question: string; options?: string[]; }

export type RouteHandler = (req: Request, url: URL) => Promise<Response | null>;

export class AskUserBridge {
  private pending = new Map<string, (answer: string) => void>();
  private extraRoutes: RouteHandler[] = [];

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

  addRoutes(handler: RouteHandler): void {
    this.extraRoutes.push(handler);
  }

  startServer(port: number, onQuestion: (req: AskRequest) => Promise<void>): void {
    Bun.serve({
      port,
      fetch: async (req) => {
        const url = new URL(req.url);

        if (req.method === "POST" && url.pathname === "/ask") {
          const body = (await req.json()) as AskRequest;
          await onQuestion(body);
          const answer = await this.waitForAnswer(body.requestId);
          return Response.json({ answer });
        }

        for (const handler of this.extraRoutes) {
          const res = await handler(req, url);
          if (res) return res;
        }

        return new Response("Not found", { status: 404 });
      },
    });
  }
}
