import { mkdirSync } from "node:fs";
import type { DetectedFailure, RecoveryResult, RecoveryStrategy, Step, StepContext } from "./types";

export async function backoff(attempt: number, baseMs: number, maxMs: number): Promise<void> {
  const jitter = Math.random() * baseMs * 0.5;
  const delay = Math.min(baseMs * Math.pow(2, attempt) + jitter, maxMs);
  await Bun.sleep(delay);
}

export const enoentRecovery: RecoveryStrategy = {
  patternId: "enoent",
  async recover(failure) {
    const path = failure.details.path as string;
    try {
      mkdirSync(path, { recursive: true });
      return { recovered: true, action: `Created directory: ${path}`, shouldRetry: true };
    } catch (e) {
      return {
        recovered: false,
        action: `Failed to create directory: ${path} — ${(e as Error).message}`,
        shouldRetry: false,
      };
    }
  },
};

export const ddosGuardRecovery: RecoveryStrategy = {
  patternId: "ddos_guard",
  async recover(_failure, _context, attempt) {
    const delay = 1000 * Math.pow(4, attempt - 1);
    await Bun.sleep(delay);
    return { recovered: true, action: `Waited ${delay}ms for DDoS-Guard cooldown`, shouldRetry: true };
  },
};

export const subagentRegressionRecovery: RecoveryStrategy = {
  patternId: "subagent_regression",
  async recover(failure) {
    const files = failure.details.unexpectedFiles as string[];
    try {
      const proc = Bun.spawn(["git", "checkout", "--", ...files], {
        stdout: "pipe",
        stderr: "pipe",
      });
      await proc.exited;
      return {
        recovered: true,
        action: `Reverted ${files.length} file(s): ${files.join(", ")}`,
        shouldRetry: true,
      };
    } catch (e) {
      return {
        recovered: false,
        action: `Failed to revert files: ${(e as Error).message}`,
        shouldRetry: false,
      };
    }
  },
};

export const apiConnectionRecovery: RecoveryStrategy = {
  patternId: "api_connection",
  async recover(_failure, _context, attempt) {
    await backoff(attempt, 1000, 30000);
    return { recovered: true, action: `Retrying after API connection backoff (attempt ${attempt})`, shouldRetry: true };
  },
};

export const rateLimitRecovery: RecoveryStrategy = {
  patternId: "rate_limit",
  async recover(_failure, _context, attempt) {
    await backoff(attempt, 2000, 60000);
    return { recovered: true, action: `Retrying after rate limit backoff (attempt ${attempt})`, shouldRetry: true };
  },
};

export const configErrorRecovery: RecoveryStrategy = {
  patternId: "config_error",
  async recover(failure) {
    const field = failure.details.field as string;
    return {
      recovered: false,
      action: `Config error: missing or invalid field "${field}". Set the required env var or fix config.`,
      shouldRetry: false,
    };
  },
};

export const contextLossRecovery: RecoveryStrategy = {
  patternId: "context_loss",
  async recover() {
    return {
      recovered: true,
      action: "Cleared sessionId to force new session",
      shouldRetry: true,
      contextPatch: { sessionId: undefined },
    };
  },
};

export function withGitDiffCheck(step: Step, allowedFiles: string[]): Step {
  return async (context: StepContext) => {
    const beforeProc = Bun.spawn(["git", "diff", "--name-only"], {
      cwd: context.workspacePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const beforeText = await new Response(beforeProc.stdout).text();
    await beforeProc.exited;
    const beforeFiles = new Set(beforeText.trim().split("\n").filter(Boolean));

    const result = await step(context);

    const afterProc = Bun.spawn(["git", "diff", "--name-only"], {
      cwd: context.workspacePath,
      stdout: "pipe",
      stderr: "pipe",
    });
    const afterText = await new Response(afterProc.stdout).text();
    await afterProc.exited;
    const afterFiles = afterText.trim().split("\n").filter(Boolean);

    const newlyModified = afterFiles.filter((f) => !beforeFiles.has(f));
    const unexpected = newlyModified.filter((f) => !allowedFiles.some((a) => f.startsWith(a)));

    if (unexpected.length > 0) {
      return {
        success: false,
        error: {
          message: `Subagent modified files outside allowed scope: ${unexpected.join(", ")}`,
          modifiedFiles: unexpected,
        },
      };
    }

    return result;
  };
}

export const allStrategies: RecoveryStrategy[] = [
  enoentRecovery,
  ddosGuardRecovery,
  subagentRegressionRecovery,
  apiConnectionRecovery,
  rateLimitRecovery,
  configErrorRecovery,
  contextLossRecovery,
];
