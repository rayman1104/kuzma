import { parseStreamLine } from "./parser";
import type { KuzmaEvent } from "./events";

export interface RunOptions {
  prompt: string;
  sessionId?: string;
  workspacePath: string;
  systemPromptPath?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

const RESULT_GRACE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function* runClaude(options: RunOptions): AsyncGenerator<KuzmaEvent> {
  const { prompt, sessionId, workspacePath, systemPromptPath, abortSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--setting-sources", "user",
  ];

  // Inject workspace CLAUDE.md as system prompt (--setting-sources user skips project CLAUDE.md)
  if (systemPromptPath) {
    try {
      const content = await Bun.file(systemPromptPath).text();
      if (content.trim()) args.push("--append-system-prompt", content);
    } catch {}
  }

  if (sessionId) args.push("--resume", sessionId);
  args.push("--", prompt);

  // Strip keys that interfere with child Claude process
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // force subscription billing
  delete env.CLAUDECODE;        // prevent nested-session detection

  const proc = Bun.spawn({
    cmd: ["claude", ...args],
    cwd: workspacePath,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  let capturedSessionId = sessionId ?? "";
  let resultReceived = false;
  let killed = false;

  const kill = () => { if (!killed) { killed = true; proc.kill(); } };

  const timeout = setTimeout(kill, timeoutMs);
  abortSignal?.addEventListener("abort", kill, { once: true });

  try {
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const event = parseStreamLine(trimmed);
        if (!event) continue;

        if (event.type === "started") capturedSessionId = event.sessionId;

        if (event.type === "completed") {
          resultReceived = true;
          if (!event.sessionId && capturedSessionId) event.sessionId = capturedSessionId;
          yield event;
          // Force-kill after grace period (CLI may hang after result)
          setTimeout(kill, RESULT_GRACE_MS);
          break;
        }

        yield event;
      }
      if (resultReceived) break;
    }

    if (!resultReceived) {
      yield { type: "completed", sessionId: capturedSessionId };
    }
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener("abort", kill);
    kill();
  }
}
