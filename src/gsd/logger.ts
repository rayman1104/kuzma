import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { RecoveryLogEntry } from "./types";

const HEADER = "| Timestamp | Execution ID | Attempt | Pattern | Description | Action | Recovered |\n| --- | --- | --- | --- | --- | --- | --- |\n";

export class RecoveryLogger {
  private logPath: string;

  constructor(basePath: string) {
    this.logPath = `${basePath}/.gsd/recovery-log.md`;
  }

  async append(entry: RecoveryLogEntry): Promise<void> {
    const dir = dirname(this.logPath);
    mkdirSync(dir, { recursive: true });

    let existing = "";
    try {
      existing = await Bun.file(this.logPath).text();
    } catch {
      // File doesn't exist yet — will create with header
    }

    if (!existing) {
      existing = HEADER;
    }

    const row = `| ${entry.timestamp} | ${entry.executionId} | ${entry.attempt} | ${entry.patternId} | ${entry.description} | ${entry.action} | ${entry.recovered} |\n`;
    await Bun.write(this.logPath, existing + row);
  }
}
