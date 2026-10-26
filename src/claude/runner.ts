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
const STDERR_CAP = 4000;

// `claude --resume <id>` fails when the transcript is gone (e.g. ~/.claude/projects
// was cleared). It exits 1 with this on stderr and emits a single is_error result
// event that echoes back the dead id — no started event, no text.
const STALE_SESSION_RE = /No conversation found with session ID/i;

interface Diagnostics {
  stderr: string;
  exitCode: number | null;
}

export async function* runClaude(options: RunOptions): AsyncGenerator<KuzmaEvent> {
  const diagnostics: Diagnostics = { stderr: "", exitCode: null };
  let sawContent = false;
  let final: KuzmaEvent | null = null;

  for await (const event of runAttempt(options, options.sessionId, diagnostics)) {
    if (event.type === "completed") { final = event; break; }
    sawContent = true;
    yield event;
  }

  // Resume failed before producing anything: retry from scratch instead of going
  // silent (and re-saving the dead id) on every message from now on.
  const staleSession =
    !!options.sessionId &&
    !sawContent &&
    final?.type === "completed" &&
    final.isError === true &&
    STALE_SESSION_RE.test(diagnostics.stderr);

  if (staleSession) {
    console.warn(`Session ${options.sessionId} is gone; starting a fresh one`);
    yield* runAttempt(options, undefined, { stderr: "", exitCode: null });
    return;
  }

  if (final) {
    if (final.type === "completed" && final.isError && diagnostics.stderr) {
      console.error("Claude exited with error:", diagnostics.stderr);
    }
    yield final;
  }
}

async function* runAttempt(
  options: RunOptions,
  sessionId: string | undefined,
  diagnostics: Diagnostics,
): AsyncGenerator<KuzmaEvent> {
  const { prompt, workspacePath, systemPromptPath, abortSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

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
  env.KUZMA_CHILD = "1";        // lets the watchdog tell our children from other Claude sessions

  const proc = Bun.spawn({
    cmd: ["claude", ...args],
    cwd: workspacePath,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  // Drain stderr concurrently — an unread pipe can block the child, and the text
  // is the only place resume failures are reported.
  const stderrDone = (async () => {
    try {
      const text = await new Response(proc.stderr).text();
      diagnostics.stderr = text.slice(0, STDERR_CAP);
    } catch {}
  })();

  let capturedSessionId = sessionId ?? "";
  let resultReceived = false;
  let killed = false;

  let stopReason: "abort" | "timeout" | null = null;

  const kill = () => { if (!killed) { killed = true; proc.kill(); } };
  const onAbort = () => { stopReason ??= "abort"; kill(); };

  const timeout = setTimeout(() => { stopReason ??= "timeout"; kill(); }, timeoutMs);
  abortSignal?.addEventListener("abort", onAbort, { once: true });

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
      // No result event: the CLI died, timed out, or was stopped. Everything but a
      // user /stop is an error, so callers don't mistake silence for a finished turn.
      yield {
        type: "completed",
        sessionId: capturedSessionId,
        isError: stopReason !== "abort",
        subtype: stopReason ?? "no_result",
      };
    }
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener("abort", onAbort);
    kill();
    diagnostics.exitCode = await proc.exited;
    await stderrDone;
  }
}
