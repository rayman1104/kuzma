export interface StepError {
  message: string;
  exitCode?: number;
  stderr?: string;
  stdout?: string;
  modifiedFiles?: string[];
}

export interface StepResult {
  success: boolean;
  data?: unknown;
  error?: StepError;
}

export interface StepContext {
  executionId: string;
  attempt: number;
  workspacePath: string;
  sessionId?: string;
}

export type Step = (context: StepContext) => Promise<StepResult>;

export type PatternId =
  | "enoent"
  | "ddos_guard"
  | "subagent_regression"
  | "api_connection"
  | "rate_limit"
  | "config_error"
  | "context_loss";

export interface DetectedFailure {
  patternId: PatternId;
  description: string;
  details: Record<string, unknown>;
}

export interface FailureDetector {
  patternId: PatternId;
  detect(error: StepError): DetectedFailure | null;
}

export interface RecoveryResult {
  recovered: boolean;
  action: string;
  shouldRetry: boolean;
  contextPatch?: Partial<StepContext>;
}

export interface RecoveryStrategy {
  patternId: PatternId;
  recover(
    failure: DetectedFailure,
    context: StepContext,
    attempt: number,
  ): Promise<RecoveryResult>;
}

export interface OrchestratorConfig {
  maxRecoveryAttempts?: number;
  basePath: string;
  workspacePath: string;
  allowedFiles?: string[];
}

export interface ExecutionResult {
  success: boolean;
  stepResult: StepResult;
  totalAttempts: number;
  recoveryLog: RecoveryLogEntry[];
  escalatedPatterns: PatternId[];
}

export interface RecoveryLogEntry {
  timestamp: string;
  executionId: string;
  attempt: number;
  patternId: PatternId;
  description: string;
  action: string;
  recovered: boolean;
}
