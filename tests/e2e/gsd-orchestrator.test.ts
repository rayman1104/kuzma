import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { SelfHealingOrchestrator } from "../../src/gsd/orchestrator";
import {
  enoentDetector,
  ddosGuardDetector,
  rateLimitDetector,
  apiConnectionDetector,
  configErrorDetector,
  contextLossDetector,
} from "../../src/gsd/patterns";
import type { Step, StepContext, FailureDetector, RecoveryStrategy } from "../../src/gsd/types";

let tmpDir: string;

beforeEach(() => {
  tmpDir = `/tmp/gsd-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

function makeOrchestrator(overrides?: { maxRecoveryAttempts?: number; allowedFiles?: string[] }) {
  return new SelfHealingOrchestrator({
    basePath: tmpDir,
    workspacePath: tmpDir,
    ...overrides,
  });
}

// ─── Group 1: Happy path ───────────────────────────────────────────────────

describe("Happy path", () => {
  test("succeeds on first attempt", async () => {
    const orch = makeOrchestrator();
    const step: Step = async () => ({ success: true, data: "ok" });
    const result = await orch.execute(step);

    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(1);
    expect(result.recoveryLog).toHaveLength(0);
    expect(result.stepResult.data).toBe("ok");
  });

  test("step throws → caught as failure", async () => {
    const orch = makeOrchestrator();
    const step: Step = async () => { throw new Error("boom"); };
    const result = await orch.execute(step);

    expect(result.success).toBe(false);
    expect(result.stepResult.error?.message).toBe("boom");
  });
});

// ─── Group 2: Pattern detection ────────────────────────────────────────────

describe("Pattern detection", () => {
  test("detects ENOENT", () => {
    const err = { message: "ENOENT: no such file or directory, open '/tmp/foo/bar.txt'" };
    const result = enoentDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.patternId).toBe("enoent");
    expect(result!.details.path).toBe("/tmp/foo/bar.txt");
  });

  test("detects DDoS-Guard in message", () => {
    const err = { message: "DDoS-Guard blocked the request" };
    const result = ddosGuardDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.patternId).toBe("ddos_guard");
  });

  test("detects DDoS-Guard via HTML in stdout", () => {
    const err = { message: "Unexpected response", stdout: "<html><body>blocked</body></html>" };
    const result = ddosGuardDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.patternId).toBe("ddos_guard");
  });

  test("detects rate limit 429", () => {
    const err = { message: "Request failed with status 429" };
    const result = rateLimitDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.details.statusCode).toBe(429);
  });

  test("detects ETIMEDOUT", () => {
    const err = { message: "connect ETIMEDOUT 1.2.3.4:443" };
    const result = apiConnectionDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.details.errorType).toBe("ETIMEDOUT");
  });

  test("detects ECONNREFUSED", () => {
    const err = { message: "connect ECONNREFUSED 127.0.0.1:3000" };
    const result = apiConnectionDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.details.errorType).toBe("ECONNREFUSED");
  });

  test("detects config error", () => {
    const err = { message: "Missing required env var: API_KEY" };
    const result = configErrorDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.details.field).toBe("API_KEY");
  });

  test("detects context loss", () => {
    const err = { message: "session not found: abc-123" };
    const result = contextLossDetector.detect(err);
    expect(result).not.toBeNull();
    expect(result!.details.sessionRef).toBe("session not found");
  });
});

// ─── Group 3: Recovery actions ─────────────────────────────────────────────

describe("Recovery actions", () => {
  test("ENOENT recovery creates directory and retries", async () => {
    const orch = makeOrchestrator();
    const missingDir = `${tmpDir}/deeply/nested/dir`;

    const step: Step = async (ctx) => {
      if (ctx.attempt === 1) {
        return {
          success: false,
          error: { message: `ENOENT: no such file or directory, open '${missingDir}/file.txt'` },
        };
      }
      return { success: true, data: "recovered" };
    };

    const result = await orch.execute(step);
    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
    expect(existsSync(missingDir)).toBe(true);
  });

  test("DDoS-Guard recovery backs off and retries", async () => {
    const orch = makeOrchestrator();
    const start = Date.now();

    const step: Step = async (ctx) => {
      if (ctx.attempt === 1) {
        return {
          success: false,
          error: { message: "DDoS-Guard blocked" },
        };
      }
      return { success: true };
    };

    const result = await orch.execute(step);
    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(2);
    // Should have waited at least ~900ms (1000ms base with some tolerance)
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
  });

  test("context loss clears sessionId", async () => {
    const orch = makeOrchestrator();
    let capturedCtx: StepContext | null = null;

    const step: Step = async (ctx) => {
      if (ctx.attempt === 1) {
        return {
          success: false,
          error: { message: "session expired" },
        };
      }
      capturedCtx = ctx;
      return { success: true };
    };

    const result = await orch.execute(step);
    expect(result.success).toBe(true);
    expect(capturedCtx!.sessionId).toBeUndefined();
  });

  test("subagent regression recovery flags unexpected files", async () => {
    const orch = makeOrchestrator();

    const step: Step = async (ctx) => {
      if (ctx.attempt === 1) {
        return {
          success: false,
          error: {
            message: "Subagent modified files outside allowed scope: README.md",
            modifiedFiles: ["README.md"],
          },
        };
      }
      return { success: true };
    };

    const result = await orch.execute(step);
    // Recovery runs git checkout which may fail in test (no git), but it retries
    expect(result.totalAttempts).toBeGreaterThanOrEqual(2);
    expect(result.recoveryLog.length).toBeGreaterThanOrEqual(1);
    expect(result.recoveryLog[0].patternId).toBe("subagent_regression");
  });
});

// ─── Group 4: Escalation ──────────────────────────────────────────────────

describe("Escalation", () => {
  test("escalates after max recovery attempts", async () => {
    const orch = makeOrchestrator({ maxRecoveryAttempts: 2 });

    // Use a path inside tmpDir so mkdirSync succeeds, but the step always fails
    const step: Step = async () => ({
      success: false,
      error: { message: `ENOENT: no such file or directory, open '${tmpDir}/sub/deep/file'` },
    });

    const result = await orch.execute(step);
    expect(result.success).toBe(false);
    expect(result.escalatedPatterns).toContain("enoent");
    // 1 initial + 2 retries = 3 total attempts
    expect(result.totalAttempts).toBe(3);
  });

  test("separate patterns get independent budgets", async () => {
    const orch = makeOrchestrator({ maxRecoveryAttempts: 1 });
    let callCount = 0;

    const step: Step = async (ctx) => {
      callCount++;
      if (ctx.attempt === 1) {
        return {
          success: false,
          error: { message: "ENOENT: no such file or directory, open '/tmp/x/y'" },
        };
      }
      if (ctx.attempt === 2) {
        return {
          success: false,
          error: { message: "session not found" },
        };
      }
      return { success: true, data: "finally" };
    };

    const result = await orch.execute(step);
    expect(result.success).toBe(true);
    expect(result.totalAttempts).toBe(3);
    expect(result.recoveryLog).toHaveLength(2);
    expect(result.recoveryLog[0].patternId).toBe("enoent");
    expect(result.recoveryLog[1].patternId).toBe("context_loss");
  });
});

// ─── Group 5: Logging ─────────────────────────────────────────────────────

describe("Logging", () => {
  test("writes markdown table to .gsd/recovery-log.md", async () => {
    const orch = makeOrchestrator();

    const step: Step = async (ctx) => {
      if (ctx.attempt === 1) {
        return {
          success: false,
          error: { message: "ENOENT: no such file or directory, open '/tmp/logtest/x'" },
        };
      }
      return { success: true };
    };

    await orch.execute(step);

    const logPath = `${tmpDir}/.gsd/recovery-log.md`;
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("| Timestamp |");
    expect(content).toContain("| enoent |");
    expect(content).toContain("Created directory:");
  });
});

// ─── Group 6: Custom strategies ───────────────────────────────────────────

describe("Custom strategies", () => {
  test("register() adds custom detector+strategy pair", async () => {
    const orch = makeOrchestrator();

    const customDetector: FailureDetector = {
      patternId: "custom" as any,
      detect(error) {
        if (/CUSTOM_ERROR/.test(error.message)) {
          return {
            patternId: "custom" as any,
            description: "Custom failure detected",
            details: {},
          };
        }
        return null;
      },
    };

    const customStrategy: RecoveryStrategy = {
      patternId: "custom" as any,
      async recover() {
        return { recovered: true, action: "Custom recovery applied", shouldRetry: true };
      },
    };

    orch.register(customDetector, customStrategy);

    const step: Step = async (ctx) => {
      if (ctx.attempt === 1) {
        return { success: false, error: { message: "CUSTOM_ERROR happened" } };
      }
      return { success: true, data: "custom-ok" };
    };

    const result = await orch.execute(step);
    expect(result.success).toBe(true);
    expect(result.recoveryLog[0].action).toBe("Custom recovery applied");
  });
});
