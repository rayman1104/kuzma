import { allDetectors } from "./patterns";
import { allStrategies } from "./strategies";
import { RecoveryLogger } from "./logger";
import type {
  DetectedFailure,
  ExecutionResult,
  FailureDetector,
  OrchestratorConfig,
  PatternId,
  RecoveryLogEntry,
  RecoveryStrategy,
  Step,
  StepContext,
  StepError,
} from "./types";

export class SelfHealingOrchestrator {
  private detectors: FailureDetector[] = [];
  private strategies: Map<PatternId, RecoveryStrategy> = new Map();
  private config: Required<Pick<OrchestratorConfig, "maxRecoveryAttempts">> & OrchestratorConfig;
  private logger: RecoveryLogger;

  constructor(config: OrchestratorConfig) {
    this.config = { maxRecoveryAttempts: 2, ...config };
    this.logger = new RecoveryLogger(config.basePath);

    for (const d of allDetectors) this.detectors.push(d);
    for (const s of allStrategies) this.strategies.set(s.patternId, s);
  }

  register(detector: FailureDetector, strategy: RecoveryStrategy): void {
    this.detectors.push(detector);
    this.strategies.set(strategy.patternId, strategy);
  }

  async execute(step: Step): Promise<ExecutionResult> {
    const executionId = crypto.randomUUID();
    const maxIterations = this.detectors.length * this.config.maxRecoveryAttempts + 1;
    const patternAttempts = new Map<PatternId, number>();
    const recoveryLog: RecoveryLogEntry[] = [];
    const escalatedPatterns: PatternId[] = [];

    let context: StepContext = {
      executionId,
      attempt: 1,
      workspacePath: this.config.workspacePath,
    };

    for (let i = 0; i < maxIterations; i++) {
      let result;
      try {
        result = await step(context);
      } catch (thrown) {
        const err = thrown instanceof Error ? thrown : new Error(String(thrown));
        result = {
          success: false,
          error: { message: err.message } as StepError,
        };
      }

      if (result.success) {
        return {
          success: true,
          stepResult: result,
          totalAttempts: context.attempt,
          recoveryLog,
          escalatedPatterns,
        };
      }

      // Detect failure pattern
      const error = result.error ?? { message: "Unknown error" };
      const failure = this.detectFailure(error);

      if (!failure) {
        return {
          success: false,
          stepResult: result,
          totalAttempts: context.attempt,
          recoveryLog,
          escalatedPatterns,
        };
      }

      // Check escalation threshold
      const prevAttempts = patternAttempts.get(failure.patternId) ?? 0;
      if (prevAttempts >= this.config.maxRecoveryAttempts) {
        if (!escalatedPatterns.includes(failure.patternId)) {
          escalatedPatterns.push(failure.patternId);
        }
        return {
          success: false,
          stepResult: result,
          totalAttempts: context.attempt,
          recoveryLog,
          escalatedPatterns,
        };
      }

      // Find strategy
      const strategy = this.strategies.get(failure.patternId);
      if (!strategy) {
        return {
          success: false,
          stepResult: result,
          totalAttempts: context.attempt,
          recoveryLog,
          escalatedPatterns,
        };
      }

      // Run recovery
      const recoveryResult = await strategy.recover(failure, context, context.attempt);

      // Log entry
      const entry: RecoveryLogEntry = {
        timestamp: new Date().toISOString(),
        executionId,
        attempt: context.attempt,
        patternId: failure.patternId,
        description: failure.description,
        action: recoveryResult.action,
        recovered: recoveryResult.recovered,
      };
      recoveryLog.push(entry);
      await this.logger.append(entry);

      // Update pattern attempts
      patternAttempts.set(failure.patternId, prevAttempts + 1);

      if (!recoveryResult.shouldRetry) {
        return {
          success: false,
          stepResult: result,
          totalAttempts: context.attempt,
          recoveryLog,
          escalatedPatterns,
        };
      }

      // Patch context and retry
      context = {
        ...context,
        ...recoveryResult.contextPatch,
        attempt: context.attempt + 1,
      };
    }

    // Should not reach here normally, but safety fallback
    return {
      success: false,
      stepResult: { success: false, error: { message: "Max iterations exceeded" } },
      totalAttempts: context.attempt,
      recoveryLog,
      escalatedPatterns,
    };
  }

  private detectFailure(error: StepError): DetectedFailure | null {
    for (const detector of this.detectors) {
      const failure = detector.detect(error);
      if (failure) return failure;
    }
    return null;
  }
}
