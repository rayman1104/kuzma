import type { FailureDetector, StepError } from "./types";

export const enoentDetector: FailureDetector = {
  patternId: "enoent",
  detect(error: StepError) {
    const match = error.message.match(/ENOENT[^']*'([^']+)'/);
    if (!match) return null;
    return {
      patternId: "enoent",
      description: `Missing file or directory: ${match[1]}`,
      details: { path: match[1] },
    };
  },
};

export const ddosGuardDetector: FailureDetector = {
  patternId: "ddos_guard",
  detect(error: StepError) {
    const text = `${error.message} ${error.stdout ?? ""} ${error.stderr ?? ""}`;
    if (/DDoS-Guard/i.test(text) || (error.stdout && /<html/i.test(error.stdout))) {
      const rawSnippet = text.slice(0, 200);
      return {
        patternId: "ddos_guard",
        description: "DDoS-Guard or HTML response detected instead of expected data",
        details: { rawSnippet },
      };
    }
    return null;
  },
};

export const subagentRegressionDetector: FailureDetector = {
  patternId: "subagent_regression",
  detect(error: StepError) {
    if (!error.modifiedFiles || error.modifiedFiles.length === 0) return null;
    // This detector flags any error that has modifiedFiles — the orchestrator
    // checks against allowedFiles when pairing with the strategy.
    return {
      patternId: "subagent_regression",
      description: `Subagent modified ${error.modifiedFiles.length} file(s)`,
      details: { unexpectedFiles: error.modifiedFiles },
    };
  },
};

export const apiConnectionDetector: FailureDetector = {
  patternId: "api_connection",
  detect(error: StepError) {
    const match = error.message.match(/ETIMEDOUT|ECONNREFUSED|ECONNRESET|socket hang up/i);
    if (!match) return null;
    return {
      patternId: "api_connection",
      description: `API connection error: ${match[0]}`,
      details: { errorType: match[0] },
    };
  },
};

export const rateLimitDetector: FailureDetector = {
  patternId: "rate_limit",
  detect(error: StepError) {
    const text = `${error.message} ${error.stderr ?? ""}`;
    if (!/429|503|rate.limit|too many requests/i.test(text)) return null;
    const codeMatch = text.match(/\b(429|503)\b/);
    return {
      patternId: "rate_limit",
      description: "Rate limit or service unavailable",
      details: { statusCode: codeMatch ? parseInt(codeMatch[1]) : undefined },
    };
  },
};

export const configErrorDetector: FailureDetector = {
  patternId: "config_error",
  detect(error: StepError) {
    const match = error.message.match(/Missing required env var[:\s]*(\w+)|validation.*failed[:\s]*(\w+)/i);
    if (!match) return null;
    const field = match[1] ?? match[2] ?? "unknown";
    return {
      patternId: "config_error",
      description: `Configuration error: ${field}`,
      details: { field },
    };
  },
};

export const contextLossDetector: FailureDetector = {
  patternId: "context_loss",
  detect(error: StepError) {
    const match = error.message.match(/session\s*(not found|expired)|invalid session/i);
    if (!match) return null;
    const sessionRef = match[0];
    return {
      patternId: "context_loss",
      description: `Context/session lost: ${sessionRef}`,
      details: { sessionRef },
    };
  },
};

export const allDetectors: FailureDetector[] = [
  enoentDetector,
  ddosGuardDetector,
  subagentRegressionDetector,
  apiConnectionDetector,
  rateLimitDetector,
  configErrorDetector,
  contextLossDetector,
];
