# Kuzma — Telegram AI Assistant Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a personal AI Telegram assistant that bridges `claude` CLI via subprocess, with Obsidian vault memory, forum topic routing, voice transcription, and scheduled tasks.

**Architecture:** Bun + grammY Telegram bot spawns `claude` CLI as a child process per conversation turn, parsing stream-json output. Per-topic persistent sessions stored in SQLite (`bun:sqlite`). Custom `ask_user` MCP server enables inline buttons. Scheduled tasks via croner + p-queue.

**Tech Stack:** Bun, TypeScript, grammY, bun:sqlite, croner, p-queue, @modelcontextprotocol/sdk, Parakeet TDT v3 (Docker)

---

## Source Documents

Read these files for full context on any design question:

| Document | Path | Contains |
|----------|------|----------|
| **Design Doc v1.0** | `docs/context/DESIGN.md` | Original vision, architecture diagrams, vault structure, scheduling spec, deployment plan, roadmap, risk matrix |
| **Deep Technical Research** | `docs/context/RESEARCH.md` | SDK internals, Takopi patterns, CLI flags, stream-json format, grammY forum topics, Parakeet benchmarks, security analysis, library comparisons |
| **This Plan** | `docs/plans/2026-03-02-kuzma-telegram-assistant.md` | Implementation tasks with full code, test-first steps, commit points |

---

## Design Decisions (from brainstorming)

These decisions were made interactively and override anything in the original Design Doc:

| # | Decision | Chosen | Rejected alternatives | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | **Claude integration** | CLI subprocess (like Takopi) | Agent SDK (`@anthropic-ai/claude-agent-sdk`) | SDK requires `ANTHROPIC_API_KEY` (pay-per-token). CLI subprocess uses Pro/Max subscription billing. Strip `ANTHROPIC_API_KEY` from env to force subscription. |
| 2 | **Starting point** | Build from scratch | Fork linuz90/claude-telegram-bot; Port Takopi to TS | linuz90 is built around SDK `query()` calls — most code irrelevant with CLI approach. Clean slate with borrowed patterns is cleaner. |
| 3 | **Memory system** | Obsidian vault (full PARA) | Plain markdown dir; Claude native memory only | Full vault at `~/vault` with `_system/`, `projects/`, `areas/`, `daily/`, `decisions/`, `inbox/`. User edits in Obsidian GUI, bot reads/writes same files. |
| 4 | **Scope** | All 5 phases (full MVP) | Phase 1 only; Phases 1-3 | Design and build the complete system end-to-end. |
| 5 | **Task persistence** | SQLite (`bun:sqlite`) | JSON in vault (`tasks.json`); SQLite + JSON mirror | Atomic writes, query support, missed-job recovery. `bun:sqlite` is built-in — zero deps. |
| 6 | **User input from Claude** | Custom `ask_user` MCP server (in MVP) | Takopi-style plain resume; Add MCP later | Standalone stdio MCP server registered in `~/.claude/settings.json`. Communicates with bot via local HTTP bridge (port 3847). ~150 lines. |
| 7 | **Runtime** | Bun | Node.js + tsx; Node.js + tsup build | Native TypeScript, faster startup, built-in sqlite, built-in test runner. |
| 8 | **Session strategy** | Per-topic persistent sessions (`--resume`) | Fresh per interaction; Hybrid with 30min window | Each forum topic / DM gets a long-lived Claude session. Sessions grow until auto-compact. |
| 9 | **Permission mode** | `bypassPermissions` | `acceptEdits`; `default + allowedTools` | Maximum autonomy. Safety via PreToolUse hooks + auth middleware + single-user whitelist. |
| 10 | **Working directory** | `~/workspace` | Bot project root; Vault directory | CLAUDE.md lives at `~/workspace/CLAUDE.md`. Claude navigates to vault or projects as needed. Neutral ground. |

---

## Critical Technical Findings (from research)

Agents working on any phase should know these:

### Claude CLI Integration
- **CLI command:** `claude -p --output-format stream-json --verbose --permission-mode bypassPermissions --setting-sources user [--resume SESSION_ID] -- "PROMPT"`
- **Force subscription billing:** Delete `ANTHROPIC_API_KEY` from subprocess env: `const env = { ...process.env }; delete env.ANTHROPIC_API_KEY;`
- **Stream-json output** is NDJSON (newline-delimited JSON). Message types:
  - `{"type":"system","subtype":"init","session_id":"..."}` — first message, capture session ID
  - `{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}` — Claude's text
  - `{"type":"assistant","message":{"content":[{"type":"tool_use","name":"...","input":{}}]}}` — tool calls
  - `{"type":"result","subtype":"success","session_id":"...","total_cost_usd":0.05,"duration_ms":12000}` — final message
- **Known bugs (critical for Task 6):**
  - Result event sometimes missing ([#1920](https://github.com/anthropics/claude-code/issues/1920)) — need timeout fallback
  - Process hangs after result event ([#25629](https://github.com/anthropics/claude-code/issues/25629)) — force-kill 30s after result
  - Orphaned processes accumulate (~50-100MB each, [#142](https://github.com/anthropics/claude-agent-sdk-typescript/issues/142)) — watchdog required (Task 20)
- **~12s startup overhead** per CLI invocation — acceptable for chat, invisible for scheduled tasks

### grammY Framework
- `import { Bot, InlineKeyboard } from "grammy"` — main imports
- **Forum General topic trap:** `message_thread_id=1` is special — NEVER pass it to `sendMessage`. Omit the parameter entirely.
- **grammY v1.38.2+** auto-targets correct forum topic in `ctx.reply()`. No `@grammyjs/auto-thread` needed.
- **Voice:** `bot.on("message:voice", handler)` → `ctx.getFile()` → download OGG → process
- **Callbacks:** `bot.on("callback_query:data", handler)` → `ctx.callbackQuery.data` → `ctx.answerCallbackQuery()`

### MCP SDK
- `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"`
- `import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"`
- **NEVER use `console.log()` in stdio MCP servers** — corrupts JSON-RPC. Use `console.error()`.
- Register via: `claude mcp add ask_user --scope user -e BOT_BRIDGE_URL=http://localhost:3847 -- bun run server.ts`

### bun:sqlite (NOT better-sqlite3)
- `import { Database } from "bun:sqlite"` — built-in, zero deps
- `better-sqlite3` has Bun compatibility issues (native C++ bindings). Use `bun:sqlite` instead.
- API: `db.prepare(sql).get(params)`, `.all(params)`, `.run(params)`, `db.exec(sql)`

### Scheduling
- **croner:** `new Cron(pattern, { timezone: "Europe/Belgrade", protect: true }, callback)` — fully Bun-compatible, zero deps
- **p-queue:** `new PQueue({ concurrency: 1 })` → `.add(fn, { priority: 10 })` — **higher priority number = executes first**
- Interactive messages get priority 10, scheduled tasks get priority 1

### Parakeet STT
- Model: `parakeet-tdt-0.6b-v3` (600M params, 25 languages incl. Russian)
- Russian WER: 5.51% FLEURS — better than Whisper Large v3
- CPU performance: ~0.2s for 10s audio (~60x real-time)
- API is OpenAI-compatible: `POST /v1/audio/transcriptions` with `file` + `model` form fields
- Needs WAV 16kHz mono input: `ffmpeg -i input.ogg -ar 16000 -ac 1 -c:a pcm_s16le output.wav`

---

## Phase Dependency Map

```
Phase 1: Core Bot ──────────────────────┐
  Tasks 1-10                            │
  Delivers: DM chat works               │
                                        ▼
Phase 2: Streaming + ask_user + Forum ──┐
  Tasks 11-15                           │
  Depends on: Phase 1 (all)             │
  Delivers: Full UX, buttons, forum     │
                                        ▼
Phase 3: Voice ─────────────────────────┐
  Tasks 16-17                           │
  Depends on: Task 11 (debounce)        │
  Delivers: Voice transcription         │
                                        ▼
Phase 4: Scheduling ────────────────────┐
  Tasks 18-19                           │
  Depends on: Task 3 (SQLite),          │
              Task 6 (runner),          │
              Task 15 (topic routing)   │
  Delivers: Cron tasks work             │
                                        ▼
Phase 5: Polish ────────────────────────┘
  Tasks 20-21
  Depends on: All above
  Delivers: Production-ready
```

### Cross-Task Dependencies Within Phases

| Task | Hard Dependencies | Soft Dependencies |
|------|-------------------|-------------------|
| 1 (scaffold) | — | — |
| 2 (config) | 1 | — |
| 3 (database) | 1 | — |
| 4 (auth) | 1 | — |
| 5 (parser) | 1 | — |
| 6 (runner) | 5 | 2 |
| 7 (renderer+session) | 1 | — |
| 8 (wire up) | 2, 3, 4, 6, 7 | — |
| 9 (vault) | — (standalone script) | — |
| 10 (pm2) | 8 | — |
| 11 (debounce) | 1 | — |
| 12 (integrate debounce) | 8, 11 | — |
| 13 (MCP server) | 1 | — |
| 14 (bridge+callbacks) | 8, 13 | — |
| 15 (forum) | 3, 8 | — |
| 16 (STT) | 1 | — |
| 17 (voice) | 11, 12, 16 | — |
| 18 (task CRUD) | 3 | — |
| 19 (scheduler) | 6, 15, 18 | — |
| 20 (watchdog) | 6 | — |
| 21 (integration) | all | — |

**Parallelizable task groups** (independent, can run simultaneously):
- Tasks 2, 3, 4, 5 (all depend only on Task 1)
- Tasks 11, 13, 16 (standalone modules)
- Tasks 9, 10 (standalone config/scripts)

---

## Environment Setup Checklist

Before starting any task, ensure:

1. **Bun installed:** `bun --version` (1.1+)
2. **Claude CLI installed:** `claude --version` + authenticated (`claude auth status`)
3. **ffmpeg installed:** `ffmpeg -version` (needed for voice in Phase 3)
4. **Docker installed:** `docker --version` (needed for Parakeet in Phase 3)
5. **pm2 installed:** `pm2 --version` (needed for Task 10)
6. **Telegram bot token:** Create via @BotFather, set `TELEGRAM_BOT_TOKEN`
7. **User ID:** Get via @userinfobot, set `TELEGRAM_USER_ID`
8. **Forum group:** Create supergroup with Topics enabled, set `TELEGRAM_FORUM_CHAT_ID`

---

## Project Paths

| Path | Purpose |
|------|---------|
| `/Users/malakhov/code/kuzma2/` | Project root (bot source code) |
| `~/workspace/` | Claude CLI working directory (CLAUDE.md lives here) |
| `~/vault/` | Obsidian vault (memory, projects, areas) |
| `~/vault/_system/` | Always-read context files (SOUL.md, MEMORY.md, ACTIVE_CONTEXT.md) |
| `~/.claude/settings.json` | Claude CLI MCP server config (ask_user registered here) |
| `./data/kuzma.db` | SQLite database (sessions, tasks, topic_mappings) |

---

## Key Patterns to Follow

1. **Test-first:** Write failing test → verify fail → implement → verify pass → commit
2. **Commit per task:** Each task ends with a focused git commit
3. **bun:sqlite not better-sqlite3:** Built-in, no native binding issues
4. **Strip API key:** Always `delete env.ANTHROPIC_API_KEY` before spawning claude
5. **General topic trap:** Never pass `message_thread_id=1` to Telegram API
6. **Force-kill after result:** Claude CLI may hang — kill 30s after receiving result event
7. **Priority queuing:** Interactive = 10 (high), Scheduled = 1 (low) in p-queue
8. **No console.log in MCP:** Stdio MCP servers must use `console.error()` only

---

## Phase 1: Core Bot Foundation

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/index.ts` (placeholder)

**Step 1: Initialize project**

Run: `cd /Users/malakhov/code/kuzma2 && bun init -y`

**Step 2: Install dependencies**

Run: `bun add grammy croner p-queue zod && bun add -d @types/bun typescript`

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

**Step 4: Create .env.example**

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_USER_ID=
TELEGRAM_FORUM_CHAT_ID=
PARAKEET_URL=http://localhost:5092
VAULT_PATH=~/vault
WORKSPACE_PATH=~/workspace
DB_PATH=./data/kuzma.db
ASK_USER_BRIDGE_PORT=3847
```

**Step 5: Create .gitignore**

```
node_modules/
dist/
data/
.env
*.db
.tmp/
```

**Step 6: Create placeholder entry**

`src/index.ts`: `console.log("Kuzma starting...");`

**Step 7: Verify**

Run: `bun run src/index.ts`
Expected: prints "Kuzma starting..."

**Step 8: Commit**

```bash
git init && git add package.json tsconfig.json .env.example .gitignore src/index.ts bun.lock
git commit -m "feat: project scaffold with bun + grammy + deps"
```

---

### Task 2: Config Module

**Files:**
- Create: `src/config.ts`
- Create: `src/config.test.ts`

**Step 1: Write failing test**

`src/config.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";

describe("config", () => {
  test("getConfig returns all required fields", () => {
    process.env.TELEGRAM_BOT_TOKEN = "test-token";
    process.env.TELEGRAM_USER_ID = "12345";
    delete require.cache[require.resolve("./config")];
    const { getConfig } = require("./config");
    const config = getConfig();
    expect(config.telegramBotToken).toBe("test-token");
    expect(config.telegramUserId).toBe(12345);
    expect(config.askUserBridgePort).toBe(3847);
  });

  test("throws on missing required var", () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete require.cache[require.resolve("./config")];
    const { getConfig } = require("./config");
    expect(() => getConfig()).toThrow("TELEGRAM_BOT_TOKEN");
  });
});
```

**Step 2: Run — expected FAIL**

Run: `bun test src/config.test.ts`

**Step 3: Implement**

`src/config.ts`:
```typescript
import { resolve } from "path";
import { homedir } from "os";

export interface Config {
  telegramBotToken: string;
  telegramUserId: number;
  telegramForumChatId: number | null;
  parakeetUrl: string;
  vaultPath: string;
  workspacePath: string;
  dbPath: string;
  askUserBridgePort: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function expandHome(p: string): string {
  return p.startsWith("~/") ? resolve(homedir(), p.slice(2)) : resolve(p);
}

export function getConfig(): Config {
  return {
    telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
    telegramUserId: Number(required("TELEGRAM_USER_ID")),
    telegramForumChatId: process.env.TELEGRAM_FORUM_CHAT_ID
      ? Number(process.env.TELEGRAM_FORUM_CHAT_ID) : null,
    parakeetUrl: process.env.PARAKEET_URL || "http://localhost:5092",
    vaultPath: expandHome(process.env.VAULT_PATH || "~/vault"),
    workspacePath: expandHome(process.env.WORKSPACE_PATH || "~/workspace"),
    dbPath: process.env.DB_PATH || "./data/kuzma.db",
    askUserBridgePort: Number(process.env.ASK_USER_BRIDGE_PORT || "3847"),
  };
}
```

**Step 4: Run — expected PASS**

Run: `bun test src/config.test.ts`

**Step 5: Commit**

```bash
git add src/config.ts src/config.test.ts
git commit -m "feat: config module with env var loading"
```

---

### Task 3: Database Setup

**Files:**
- Create: `src/db/schema.ts`
- Create: `src/db/client.ts`
- Create: `src/db/client.test.ts`

Uses `bun:sqlite` (built-in, zero deps).

**Step 1: Write failing test**

`src/db/client.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { SessionRepo, TopicRepo } from "./client";

describe("SessionRepo", () => {
  let db: Database;
  let repo: SessionRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    repo = new SessionRepo(db);
  });

  test("upsert and get", () => {
    repo.upsert("123:dm", "session-abc");
    expect(repo.get("123:dm")).toBe("session-abc");
  });

  test("upsert overwrites", () => {
    repo.upsert("123:dm", "old");
    repo.upsert("123:dm", "new");
    expect(repo.get("123:dm")).toBe("new");
  });

  test("get returns null for missing key", () => {
    expect(repo.get("unknown")).toBeNull();
  });
});

describe("TopicRepo", () => {
  let db: Database;
  let repo: TopicRepo;

  beforeEach(() => {
    db = new Database(":memory:");
    initSchema(db);
    repo = new TopicRepo(db);
  });

  test("upsert and getThreadId", () => {
    repo.upsert("job-search", 42, -100123);
    expect(repo.getThreadId("job-search", -100123)).toBe(42);
  });

  test("getName by threadId", () => {
    repo.upsert("job-search", 42, -100123);
    expect(repo.getName(42, -100123)).toBe("job-search");
  });
});
```

**Step 2: Run — expected FAIL**

Run: `bun test src/db/client.test.ts`

**Step 3: Write schema**

`src/db/schema.ts`:
```typescript
import { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      key TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      what TEXT NOT NULL,
      schedule TEXT NOT NULL,
      until_condition TEXT,
      urgency TEXT NOT NULL DEFAULT 'low',
      deliver_to TEXT NOT NULL,
      quiet_start TEXT,
      quiet_end TEXT,
      quiet_action TEXT NOT NULL DEFAULT 'queue',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_run_at TEXT,
      next_run_at TEXT
    );
    CREATE TABLE IF NOT EXISTS topic_mappings (
      name TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      chat_id INTEGER NOT NULL,
      PRIMARY KEY (name, chat_id)
    );
  `);
}
```

**Step 4: Write repos**

`src/db/client.ts`:
```typescript
import { Database } from "bun:sqlite";
import { initSchema } from "./schema";
import { mkdirSync } from "fs";
import { dirname } from "path";

export function createDb(dbPath: string): Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  initSchema(db);
  return db;
}

export class SessionRepo {
  constructor(private db: Database) {}

  get(key: string): string | null {
    const row = this.db
      .prepare("SELECT session_id FROM sessions WHERE key = ?")
      .get(key) as { session_id: string } | null;
    return row?.session_id ?? null;
  }

  upsert(key: string, sessionId: string): void {
    this.db.prepare(
      `INSERT INTO sessions (key, session_id, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET session_id = excluded.session_id, updated_at = excluded.updated_at`
    ).run(key, sessionId);
  }

  delete(key: string): void {
    this.db.prepare("DELETE FROM sessions WHERE key = ?").run(key);
  }
}

export class TopicRepo {
  constructor(private db: Database) {}

  upsert(name: string, threadId: number, chatId: number): void {
    this.db.prepare(
      `INSERT INTO topic_mappings (name, thread_id, chat_id) VALUES (?, ?, ?)
       ON CONFLICT(name, chat_id) DO UPDATE SET thread_id = excluded.thread_id`
    ).run(name, threadId, chatId);
  }

  getThreadId(name: string, chatId: number): number | null {
    const row = this.db
      .prepare("SELECT thread_id FROM topic_mappings WHERE name = ? AND chat_id = ?")
      .get(name, chatId) as { thread_id: number } | null;
    return row?.thread_id ?? null;
  }

  getName(threadId: number, chatId: number): string | null {
    const row = this.db
      .prepare("SELECT name FROM topic_mappings WHERE thread_id = ? AND chat_id = ?")
      .get(threadId, chatId) as { name: string } | null;
    return row?.name ?? null;
  }

  all(chatId: number): Array<{ name: string; thread_id: number }> {
    return this.db
      .prepare("SELECT name, thread_id FROM topic_mappings WHERE chat_id = ?")
      .all(chatId) as Array<{ name: string; thread_id: number }>;
  }
}
```

**Step 5: Run — expected PASS**

Run: `bun test src/db/client.test.ts`

**Step 6: Commit**

```bash
git add src/db/
git commit -m "feat: sqlite database with sessions and topic mappings"
```

---

### Task 4: Auth Middleware

**Files:**
- Create: `src/bot/middleware/auth.ts`
- Create: `src/bot/middleware/auth.test.ts`

**Step 1: Write failing test**

`src/bot/middleware/auth.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { createAuthMiddleware } from "./auth";

describe("auth middleware", () => {
  const mw = createAuthMiddleware(12345);

  test("allows authorized user", async () => {
    let called = false;
    await mw({ from: { id: 12345 } } as any, async () => { called = true; });
    expect(called).toBe(true);
  });

  test("blocks unauthorized user", async () => {
    let called = false;
    await mw({ from: { id: 99999 } } as any, async () => { called = true; });
    expect(called).toBe(false);
  });

  test("blocks no from", async () => {
    let called = false;
    await mw({ from: undefined } as any, async () => { called = true; });
    expect(called).toBe(false);
  });
});
```

**Step 2: Run — expected FAIL**

Run: `bun test src/bot/middleware/auth.test.ts`

**Step 3: Implement**

`src/bot/middleware/auth.ts`:
```typescript
import type { Context, NextFunction } from "grammy";

export function createAuthMiddleware(allowedUserId: number) {
  return async (ctx: Context, next: NextFunction): Promise<void> => {
    if (ctx.from?.id !== allowedUserId) return;
    await next();
  };
}
```

**Step 4: Run — expected PASS**

Run: `bun test src/bot/middleware/auth.test.ts`

**Step 5: Commit**

```bash
git add src/bot/middleware/
git commit -m "feat: auth middleware"
```

---

### Task 5: Claude Event Types + Stream Parser

**Files:**
- Create: `src/claude/events.ts`
- Create: `src/claude/parser.ts`
- Create: `src/claude/parser.test.ts`

**Step 1: Write event types**

`src/claude/events.ts`:
```typescript
export type KuzmaEvent =
  | { type: "started"; sessionId: string }
  | { type: "text"; content: string }
  | { type: "tool_use"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; output: string }
  | { type: "completed"; sessionId: string; cost?: number; duration?: number }
  | { type: "error"; message: string };
```

**Step 2: Write failing test**

`src/claude/parser.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { parseStreamLine } from "./parser";

describe("parseStreamLine", () => {
  test("parses system init", () => {
    const line = JSON.stringify({ type: "system", subtype: "init", session_id: "abc-123" });
    expect(parseStreamLine(line)).toEqual({ type: "started", sessionId: "abc-123" });
  });

  test("parses assistant text", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello" }] },
    });
    expect(parseStreamLine(line)).toEqual({ type: "text", content: "Hello" });
  });

  test("parses tool_use", () => {
    const line = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/x" } }] },
    });
    expect(parseStreamLine(line)).toEqual({ type: "tool_use", name: "Read", input: { file_path: "/x" } });
  });

  test("parses result", () => {
    const line = JSON.stringify({
      type: "result", subtype: "success", session_id: "abc", total_cost_usd: 0.05, duration_ms: 12000,
    });
    expect(parseStreamLine(line)).toEqual({ type: "completed", sessionId: "abc", cost: 0.05, duration: 12000 });
  });

  test("returns null for unknown types", () => {
    expect(parseStreamLine(JSON.stringify({ type: "unknown" }))).toBeNull();
  });

  test("returns error for invalid JSON", () => {
    const event = parseStreamLine("not json{");
    expect(event?.type).toBe("error");
  });
});
```

**Step 3: Run — expected FAIL**

Run: `bun test src/claude/parser.test.ts`

**Step 4: Implement parser**

`src/claude/parser.ts`:
```typescript
import type { KuzmaEvent } from "./events";

export function parseStreamLine(line: string): KuzmaEvent | null {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return { type: "error", message: `Failed to parse: ${line.slice(0, 100)}` };
  }

  if (msg.type === "system" && msg.subtype === "init") {
    return { type: "started", sessionId: msg.session_id };
  }

  if (msg.type === "assistant" && msg.message?.content) {
    for (const block of msg.message.content) {
      if (block.type === "text") return { type: "text", content: block.text };
      if (block.type === "tool_use") return { type: "tool_use", name: block.name, input: block.input };
    }
  }

  if (msg.type === "result") {
    return { type: "completed", sessionId: msg.session_id ?? "", cost: msg.total_cost_usd, duration: msg.duration_ms };
  }

  return null;
}
```

**Step 5: Run — expected PASS**

Run: `bun test src/claude/parser.test.ts`

**Step 6: Commit**

```bash
git add src/claude/
git commit -m "feat: claude stream-json event types and parser"
```

---

### Task 6: Claude CLI Runner

**Files:**
- Create: `src/claude/runner.ts`

Spawns `claude` CLI as subprocess. Integration-only (no unit test — requires real `claude` binary).

**Step 1: Write runner**

`src/claude/runner.ts`:
```typescript
import { spawn } from "bun";
import { parseStreamLine } from "./parser";
import type { KuzmaEvent } from "./events";

export interface RunOptions {
  prompt: string;
  sessionId?: string;
  workspacePath: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}

const RESULT_GRACE_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export async function* runClaude(options: RunOptions): AsyncGenerator<KuzmaEvent> {
  const { prompt, sessionId, workspacePath, abortSignal, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

  const args = [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "bypassPermissions",
    "--setting-sources", "user",
  ];
  if (sessionId) args.push("--resume", sessionId);
  args.push("--", prompt);

  // Strip ANTHROPIC_API_KEY to force subscription billing
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;

  const proc = spawn({
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
```

**Step 2: Verify compilation**

Run: `bunx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/claude/runner.ts
git commit -m "feat: claude CLI runner with subprocess spawning"
```

---

### Task 7: Session Key + Telegram Renderer

**Files:**
- Create: `src/bot/session.ts`
- Create: `src/bot/session.test.ts`
- Create: `src/claude/renderer.ts`
- Create: `src/claude/renderer.test.ts`

**Step 1: Write failing session key test**

`src/bot/session.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { getSessionKey } from "./session";

describe("getSessionKey", () => {
  test("DM", () => {
    expect(getSessionKey({
      chat: { id: 123, type: "private" }, message: {},
    } as any)).toBe("123:dm");
  });

  test("forum topic", () => {
    expect(getSessionKey({
      chat: { id: -100, type: "supergroup", is_forum: true },
      message: { message_thread_id: 42, is_topic_message: true },
    } as any)).toBe("-100:42");
  });

  test("forum general", () => {
    expect(getSessionKey({
      chat: { id: -100, type: "supergroup", is_forum: true },
      message: {},
    } as any)).toBe("-100:general");
  });
});
```

**Step 2: Run — expected FAIL**

Run: `bun test src/bot/session.test.ts`

**Step 3: Implement session key**

`src/bot/session.ts`:
```typescript
import type { Context } from "grammy";

export function getSessionKey(ctx: Context): string {
  const chatId = ctx.chat!.id;
  const msg = (ctx.message ?? ctx.callbackQuery?.message) as any;
  const threadId = msg?.message_thread_id as number | undefined;
  const isTopicMessage = msg?.is_topic_message;

  if (isTopicMessage && threadId) return `${chatId}:${threadId}`;
  if (ctx.chat && "is_forum" in ctx.chat && (ctx.chat as any).is_forum) return `${chatId}:general`;
  return `${chatId}:dm`;
}
```

**Step 4: Write failing renderer test**

`src/claude/renderer.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { splitMessage } from "./renderer";

describe("splitMessage", () => {
  test("short returns single chunk", () => {
    expect(splitMessage("hello")).toEqual(["hello"]);
  });

  test("splits at paragraph boundary", () => {
    const a = "A".repeat(4000);
    const b = "B".repeat(100);
    const chunks = splitMessage(`${a}\n\n${b}`);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(a);
    expect(chunks[1]).toBe(b);
  });

  test("hard splits when no boundary", () => {
    const text = "X".repeat(5000);
    const chunks = splitMessage(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(4096);
  });
});
```

**Step 5: Implement renderer**

`src/claude/renderer.ts`:
```typescript
import type { Api } from "grammy";
import type { KuzmaEvent } from "./events";

const MAX_LEN = 4096;
const EDIT_THROTTLE_MS = 1000;

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_LEN) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_LEN) {
    let splitAt = remaining.lastIndexOf("\n\n", MAX_LEN);
    if (splitAt <= 0) splitAt = remaining.lastIndexOf("\n", MAX_LEN);
    if (splitAt <= 0) splitAt = MAX_LEN;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class TelegramRenderer {
  private messageId: number | null = null;
  private accText = "";
  private lastEdit = 0;
  private timer: Timer | null = null;

  constructor(
    private api: Api,
    private chatId: number,
    private threadId?: number // never pass 1 (General topic trap)
  ) {
    if (threadId === 1) this.threadId = undefined;
  }

  async handleEvent(event: KuzmaEvent): Promise<void> {
    switch (event.type) {
      case "started":
      case "tool_use":
        await this.sendTyping();
        break;
      case "text":
        this.accText += event.content;
        await this.scheduleEdit();
        break;
      case "completed":
        await this.flush();
        break;
      case "error":
        await this.sendNew(`Error: ${event.message}`);
        break;
    }
  }

  private async sendTyping(): Promise<void> {
    try {
      const opts: any = {};
      if (this.threadId) opts.message_thread_id = this.threadId;
      await this.api.sendChatAction(this.chatId, "typing", opts);
    } catch {}
  }

  private async scheduleEdit(): Promise<void> {
    if (this.timer) return;
    const delay = Math.max(0, EDIT_THROTTLE_MS - (Date.now() - this.lastEdit));
    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.doEdit();
    }, delay);
  }

  private async doEdit(): Promise<void> {
    if (!this.accText.trim()) return;
    const display = this.accText.slice(0, MAX_LEN);
    try {
      if (this.messageId) {
        await this.api.editMessageText(this.chatId, this.messageId, display);
      } else {
        const opts: any = {};
        if (this.threadId) opts.message_thread_id = this.threadId;
        const sent = await this.api.sendMessage(this.chatId, display, opts);
        this.messageId = sent.message_id;
      }
      this.lastEdit = Date.now();
    } catch {}
  }

  private async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.accText.trim()) return;
    const chunks = splitMessage(this.accText);
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0 && this.messageId) {
        try { await this.api.editMessageText(this.chatId, this.messageId, chunks[i]); }
        catch { await this.sendNew(chunks[i]); }
      } else {
        await this.sendNew(chunks[i]);
      }
    }
  }

  private async sendNew(text: string): Promise<void> {
    const opts: any = {};
    if (this.threadId) opts.message_thread_id = this.threadId;
    try {
      const sent = await this.api.sendMessage(this.chatId, text, opts);
      this.messageId = sent.message_id;
    } catch (err: any) {
      if (err?.description?.includes("message thread not found")) {
        const sent = await this.api.sendMessage(this.chatId, text);
        this.messageId = sent.message_id;
      }
    }
  }
}
```

**Step 6: Run all tests — expected PASS**

Run: `bun test`

**Step 7: Commit**

```bash
git add src/bot/session.ts src/bot/session.test.ts src/claude/renderer.ts src/claude/renderer.test.ts
git commit -m "feat: session key derivation and telegram renderer"
```

---

### Task 8: Wire Up — Bot Entry Point + DM Handler

**Files:**
- Create: `src/bot/telegram.ts`
- Create: `src/bot/handlers/message.ts`
- Modify: `src/index.ts`

**Step 1: Bot factory**

`src/bot/telegram.ts`:
```typescript
import { Bot } from "grammy";
import type { Config } from "../config";
import { createAuthMiddleware } from "./middleware/auth";

export function createBot(config: Config): Bot {
  const bot = new Bot(config.telegramBotToken);
  bot.use(createAuthMiddleware(config.telegramUserId));
  bot.catch((err) => console.error("Bot error:", err));
  return bot;
}
```

**Step 2: Message handler**

`src/bot/handlers/message.ts`:
```typescript
import type { Bot, Context } from "grammy";
import type { Config } from "../../config";
import { SessionRepo } from "../../db/client";
import { runClaude } from "../../claude/runner";
import { TelegramRenderer } from "../../claude/renderer";
import { getSessionKey } from "../session";
import type { Database } from "bun:sqlite";

export function setupMessageHandler(bot: Bot, config: Config, db: Database) {
  const sessions = new SessionRepo(db);
  const activeAborts = new Map<string, AbortController>();

  async function processWithClaude(ctx: Context, text: string): Promise<void> {
    const sessionKey = getSessionKey(ctx);
    const existingSession = sessions.get(sessionKey) ?? undefined;

    const prev = activeAborts.get(sessionKey);
    if (prev) prev.abort();

    const ac = new AbortController();
    activeAborts.set(sessionKey, ac);

    const threadId = (ctx.message as any)?.message_thread_id as number | undefined;
    const renderer = new TelegramRenderer(ctx.api, ctx.chat!.id, threadId);

    try {
      for await (const event of runClaude({
        prompt: text,
        sessionId: existingSession,
        workspacePath: config.workspacePath,
        abortSignal: ac.signal,
      })) {
        await renderer.handleEvent(event);
        if ((event.type === "started" || event.type === "completed") && event.sessionId) {
          sessions.upsert(sessionKey, event.sessionId);
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Runner error:", err);
        try { await ctx.reply("Something went wrong."); } catch {}
      }
    } finally {
      activeAborts.delete(sessionKey);
    }
  }

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text;
    if (!text || text.startsWith("/")) return;
    await processWithClaude(ctx, text);
  });

  bot.command("new", async (ctx) => {
    sessions.delete(getSessionKey(ctx));
    await ctx.reply("New session started.");
  });

  bot.command("stop", async (ctx) => {
    const key = getSessionKey(ctx);
    const ac = activeAborts.get(key);
    if (ac) { ac.abort(); await ctx.reply("Stopped."); }
    else { await ctx.reply("Nothing running."); }
  });

  return { processWithClaude };
}
```

**Step 3: Entry point**

`src/index.ts`:
```typescript
import { getConfig } from "./config";
import { createDb } from "./db/client";
import { createBot } from "./bot/telegram";
import { setupMessageHandler } from "./bot/handlers/message";

async function main() {
  const config = getConfig();
  const db = createDb(config.dbPath);
  const bot = createBot(config);

  setupMessageHandler(bot, config, db);

  console.log("Kuzma starting...");
  bot.start({
    onStart: async (botInfo) => {
      console.log(`Bot @${botInfo.username} is running`);
      try { await bot.api.sendMessage(config.telegramUserId, "Kuzma online."); } catch {}
    },
  });

  const shutdown = () => { bot.stop(); db.close(); process.exit(0); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch(console.error);
```

**Step 4: Create .env and test manually**

Run: `cp .env.example .env` — fill in real values.
Run: `bun run src/index.ts`
Expected: Bot starts, sends "Kuzma online." to DM. Send text → Claude responds.

**Step 5: Commit**

```bash
git add src/bot/telegram.ts src/bot/handlers/message.ts src/index.ts
git commit -m "feat: wire bot with DM handler and claude runner"
```

---

### Task 9: Vault Setup + CLAUDE.md

**Files:**
- Create: `scripts/setup-vault.sh`
- Create: `templates/CLAUDE.md`

**Step 1: Vault setup script**

`scripts/setup-vault.sh`:
```bash
#!/bin/bash
set -euo pipefail
VAULT_PATH="${VAULT_PATH:-$HOME/vault}"
WORKSPACE_PATH="${WORKSPACE_PATH:-$HOME/workspace}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Setting up vault at $VAULT_PATH..."
mkdir -p "$VAULT_PATH"/{_system,projects,areas,daily,decisions,inbox}

cat > "$VAULT_PATH/_system/SOUL.md" << 'EOF'
# Soul
## Identity
Ты — Кузьма, персональный AI-ассистент Дмитрия. Мастеровой — надёжный, конкретный, без лишних слов.
## Communication Style
- Русский по умолчанию, English для технических тем если уместно
- Кратко и по делу, без воды
- Если нужно уточнение — спроси, не угадывай
## Rules
- Никогда не удаляй файлы из vault без подтверждения
- Обновляй ACTIVE_CONTEXT.md после каждого ответа
- Логируй важные решения в decisions/
- Финансовые данные — только в vault
EOF

cat > "$VAULT_PATH/_system/MEMORY.md" << 'EOF'
# Memory
## Personal
- Белград, Сербия с Русланой и сыном
- Не ем чеснок и лук
## Work
- Senior Software Engineer, 8+ лет
- TypeScript, React, Next.js, Node.js, Drizzle
- Проекты: RepBoost, Budget Vision
EOF

cat > "$VAULT_PATH/_system/ACTIVE_CONTEXT.md" << 'EOF'
# Active Context
## Current Task
(none)
## Last Action
Initial vault setup
## Next Steps
(none)
EOF

mkdir -p "$WORKSPACE_PATH"
cp "$SCRIPT_DIR/../templates/CLAUDE.md" "$WORKSPACE_PATH/CLAUDE.md"
echo "Done. Vault: $VAULT_PATH, CLAUDE.md: $WORKSPACE_PATH/CLAUDE.md"
```

**Step 2: CLAUDE.md template**

`templates/CLAUDE.md`:
```markdown
# Kuzma AI Assistant

## On Session Start
- Read vault/_system/SOUL.md, MEMORY.md, ACTIVE_CONTEXT.md
- If ACTIVE_CONTEXT.md has unfinished task, resume it

## On Every Response
- Update vault/_system/ACTIVE_CONTEXT.md (current_task, last_action, next_steps)
- Keep responses concise — this is Telegram

## On New Facts
- Append to vault/_system/MEMORY.md (keep under 2000 tokens)

## On Decisions
- Create vault/decisions/YYYY-MM-<topic>.md

## Tools
- Gmail, Google Calendar, Telegram userbot (via MCP)
- Filesystem access to vault and workspace
- ask_user — inline Telegram buttons for user decisions
```

**Step 3: Run**

Run: `chmod +x scripts/setup-vault.sh && bash scripts/setup-vault.sh`

**Step 4: Commit**

```bash
git add scripts/setup-vault.sh templates/CLAUDE.md
git commit -m "feat: vault setup script and CLAUDE.md template"
```

---

### Task 10: pm2 Config

**Files:**
- Create: `ecosystem.config.cjs`

**Step 1: Create config**

`ecosystem.config.cjs`:
```javascript
module.exports = {
  apps: [{
    name: "kuzma",
    script: "src/index.ts",
    interpreter: "bun",
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: { NODE_ENV: "production" },
  }],
};
```

**Step 2: Test**

Run: `pm2 start ecosystem.config.cjs && pm2 logs kuzma --lines 5`
Then: `pm2 stop kuzma`

**Step 3: Commit**

```bash
git add ecosystem.config.cjs
git commit -m "feat: pm2 config"
```

---

## Phase 2: Streaming UX + ask_user + Forum Topics

### Task 11: Debounce Middleware

**Files:**
- Create: `src/bot/middleware/debounce.ts`
- Create: `src/bot/middleware/debounce.test.ts`

**Step 1: Write failing test**

`src/bot/middleware/debounce.test.ts`:
```typescript
import { describe, test, expect } from "bun:test";
import { Debouncer } from "./debounce";

describe("Debouncer", () => {
  test("fires after delay", async () => {
    const results: string[] = [];
    const d = new Debouncer(50, 500, (_k, t) => results.push(t));
    d.add("k", "hello");
    expect(results).toEqual([]);
    await Bun.sleep(100);
    expect(results).toEqual(["hello"]);
  });

  test("concatenates within window", async () => {
    const results: string[] = [];
    const d = new Debouncer(100, 500, (_k, t) => results.push(t));
    d.add("k", "a");
    await Bun.sleep(30);
    d.add("k", "b");
    await Bun.sleep(150);
    expect(results).toEqual(["a\nb"]);
  });

  test("independent keys", async () => {
    const results: string[] = [];
    const d = new Debouncer(50, 500, (_k, t) => results.push(t));
    d.add("a", "1");
    d.add("b", "2");
    await Bun.sleep(100);
    expect(results).toContain("1");
    expect(results).toContain("2");
  });
});
```

**Step 2: Run — expected FAIL**

Run: `bun test src/bot/middleware/debounce.test.ts`

**Step 3: Implement**

`src/bot/middleware/debounce.ts`:
```typescript
export type DebouncerCallback = (key: string, combinedText: string) => void;

interface Entry { messages: string[]; timer: Timer; lastFired?: string; lastFiredAt?: number; }

export class Debouncer {
  private pending = new Map<string, Entry>();

  constructor(
    private windowMs: number,
    private extendedMs: number,
    private onFire: DebouncerCallback
  ) {}

  add(key: string, text: string): void {
    const isAppend = text.startsWith("+");
    const clean = isAppend ? text.slice(1).trimStart() : text;
    const existing = this.pending.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push(clean);
      existing.timer = setTimeout(() => this.fire(key), this.windowMs);
      return;
    }

    // Check ghost for "+" append to recently fired
    if (isAppend) {
      const ghost = this.pending.get(`_g:${key}`);
      if (ghost?.lastFiredAt && Date.now() - ghost.lastFiredAt < this.extendedMs) {
        this.pending.delete(`_g:${key}`);
        const entry: Entry = {
          messages: [ghost.lastFired!, clean],
          timer: setTimeout(() => this.fire(key), this.windowMs),
        };
        this.pending.set(key, entry);
        return;
      }
    }

    this.pending.set(key, {
      messages: [clean],
      timer: setTimeout(() => this.fire(key), this.windowMs),
    });
  }

  private fire(key: string): void {
    const entry = this.pending.get(key);
    if (!entry) return;
    const combined = entry.messages.join("\n");
    this.pending.delete(key);
    // Ghost for "+" append
    this.pending.set(`_g:${key}`, {
      messages: [],
      timer: setTimeout(() => this.pending.delete(`_g:${key}`), this.extendedMs),
      lastFired: combined,
      lastFiredAt: Date.now(),
    });
    this.onFire(key, combined);
  }

  cancel(key: string): void {
    const e = this.pending.get(key);
    if (e) { clearTimeout(e.timer); this.pending.delete(key); }
  }
}
```

**Step 4: Run — expected PASS**

Run: `bun test src/bot/middleware/debounce.test.ts`

**Step 5: Commit**

```bash
git add src/bot/middleware/debounce.ts src/bot/middleware/debounce.test.ts
git commit -m "feat: debounce middleware"
```

---

### Task 12: Integrate Debounce + Refactor Message Handler

**Files:**
- Modify: `src/bot/handlers/message.ts`
- Modify: `src/index.ts`

Refactor `setupMessageHandler` to use Debouncer. User messages flow through debouncer → combined text → Claude. Export debouncer and ctxMap for voice handler reuse.

See Task 8 for the handler pattern. Add debouncer integration:

```typescript
// In setupMessageHandler:
const debouncer = new Debouncer(2000, 30000, (key, combined) => {
  const ctx = ctxMap.get(key);
  if (ctx) processWithClaude(ctx, combined).catch(console.error);
});

bot.on("message:text", (ctx) => {
  const text = ctx.message.text;
  if (!text || text.startsWith("/")) return;
  const key = getSessionKey(ctx);
  ctxMap.set(key, ctx);
  debouncer.add(key, text);
});

return { debouncer, ctxMap, processWithClaude };
```

**Commit:**
```bash
git add src/bot/handlers/message.ts src/index.ts
git commit -m "feat: integrate debounce into message flow"
```

---

### Task 13: ask_user MCP Server

**Files:**
- Create: `src/mcp/ask-user/server.ts`

**Step 1: Install MCP SDK**

Run: `bun add @modelcontextprotocol/sdk`

**Step 2: Write server**

`src/mcp/ask-user/server.ts`:
```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BRIDGE_URL = process.env.BOT_BRIDGE_URL || "http://localhost:3847";
const TIMEOUT_MS = 5 * 60 * 1000;

const server = new McpServer({ name: "ask_user", version: "1.0.0" });

server.registerTool(
  "ask_user",
  {
    title: "Ask User",
    description: "Present a question with optional inline button choices via Telegram.",
    inputSchema: z.object({
      question: z.string().describe("Question to ask"),
      options: z.array(z.string()).optional().describe("Button choices"),
    }),
  },
  async ({ question, options }) => {
    const requestId = crypto.randomUUID();
    const ac = new AbortController();
    const timeout = setTimeout(() => ac.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(`${BRIDGE_URL}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, question, options }),
        signal: ac.signal,
      });
      if (!res.ok) return { content: [{ type: "text" as const, text: `Bridge error: ${res.status}` }] };
      const data = (await res.json()) as { answer: string };
      return { content: [{ type: "text" as const, text: data.answer }] };
    } catch (err: any) {
      const msg = err.name === "AbortError"
        ? "User did not respond within 5 minutes."
        : `Error: ${err.message}`;
      return { content: [{ type: "text" as const, text: msg }] };
    } finally {
      clearTimeout(timeout);
    }
  }
);

const transport = new StdioServerTransport();
server.connect(transport).catch((e) => { console.error(e); process.exit(1); });
```

**Step 3: Commit**

```bash
git add src/mcp/ask-user/server.ts
git commit -m "feat: ask_user MCP server"
```

---

### Task 14: ask_user Bridge + Callback Handler

**Files:**
- Create: `src/bot/bridge.ts`
- Create: `src/bot/handlers/callback.ts`
- Create: `scripts/register-mcp.sh`
- Modify: `src/index.ts`

**Step 1: Bridge**

`src/bot/bridge.ts`:
```typescript
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
```

**Step 2: Callback handler**

`src/bot/handlers/callback.ts`:
```typescript
import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import type { AskUserBridge, AskRequest } from "../bridge";

export function setupCallbackHandler(bot: Bot, bridge: AskUserBridge, chatId: number) {
  async function onQuestion(req: AskRequest): Promise<void> {
    const kb = new InlineKeyboard();
    if (req.options?.length) {
      for (const opt of req.options) kb.text(opt, `ask:${req.requestId}:${opt}`).row();
    } else {
      kb.text("OK", `ask:${req.requestId}:OK`);
    }
    await bot.api.sendMessage(chatId, req.question, { reply_markup: kb });
  }

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (!data.startsWith("ask:")) return;
    const [, requestId, ...rest] = data.split(":");
    const answer = rest.join(":");
    if (bridge.resolve(requestId, answer)) {
      await ctx.answerCallbackQuery({ text: "Got it" });
      try {
        const text = ctx.callbackQuery.message?.text ?? "";
        await ctx.editMessageText(`${text}\n\n> ${answer}`);
      } catch {}
    } else {
      await ctx.answerCallbackQuery({ text: "Expired" });
    }
  });

  return onQuestion;
}
```

**Step 3: MCP registration script**

`scripts/register-mcp.sh`:
```bash
#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
claude mcp add ask_user --scope user \
  -e BOT_BRIDGE_URL=http://localhost:3847 \
  -- bun run "$DIR/src/mcp/ask-user/server.ts"
echo "ask_user MCP registered"
```

**Step 4: Wire into index.ts**

```typescript
import { AskUserBridge } from "./bot/bridge";
import { setupCallbackHandler } from "./bot/handlers/callback";
// After bot creation:
const bridge = new AskUserBridge();
const onQuestion = setupCallbackHandler(bot, bridge, config.telegramUserId);
bridge.startServer(config.askUserBridgePort, onQuestion);
```

**Step 5: Register and test**

Run: `chmod +x scripts/register-mcp.sh && bash scripts/register-mcp.sh`
Run bot → test ask_user via conversation.

**Step 6: Commit**

```bash
git add src/bot/bridge.ts src/bot/handlers/callback.ts scripts/register-mcp.sh src/index.ts
git commit -m "feat: ask_user bridge with inline keyboard callbacks"
```

---

### Task 15: Forum Topic Routing

**Files:**
- Create: `src/bot/handlers/forum.ts`
- Modify: `src/index.ts`

**Step 1: Forum handler**

`src/bot/handlers/forum.ts`:
```typescript
import type { Bot } from "grammy";
import { TopicRepo } from "../../db/client";
import type { Database } from "bun:sqlite";

export function setupForumHandlers(bot: Bot, db: Database) {
  const topics = new TopicRepo(db);

  bot.on("message:forum_topic_created", (ctx) => {
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id!;
    const name = ctx.message.forum_topic_created!.name.toLowerCase();
    topics.upsert(name, threadId, chatId);
    console.log(`Topic mapped: "${name}" → ${threadId}`);
  });

  bot.on("message:forum_topic_edited", (ctx) => {
    const chatId = ctx.chat.id;
    const threadId = ctx.message.message_thread_id!;
    const newName = (ctx.message as any).forum_topic_edited?.name;
    if (newName) topics.upsert(newName.toLowerCase(), threadId, chatId);
  });
}
```

**Step 2: Add to index.ts**

```typescript
import { setupForumHandlers } from "./bot/handlers/forum";
// After setupMessageHandler:
setupForumHandlers(bot, db);
```

Note: Forum messages already work via `getSessionKey` (returns `chatId:threadId`).

**Step 3: Test manually in forum group**

**Step 4: Commit**

```bash
git add src/bot/handlers/forum.ts src/index.ts
git commit -m "feat: forum topic routing with auto mapping"
```

---

## Phase 3: Voice

### Task 16: Parakeet Docker + STT Client

**Files:**
- Create: `docker-compose.yml`
- Create: `src/stt/parakeet.ts`

**Step 1: Docker compose**

`docker-compose.yml`:
```yaml
services:
  parakeet-stt:
    image: ghcr.io/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai:cpu
    ports: ["5092:5092"]
    restart: unless-stopped
    deploy:
      resources:
        limits: { memory: 3G }
```

**Step 2: STT client**

`src/stt/parakeet.ts`:
```typescript
export async function transcribeAudio(wavPath: string, apiUrl: string): Promise<string> {
  const form = new FormData();
  form.append("file", Bun.file(wavPath));
  form.append("model", "parakeet-tdt-0.6b-v3");
  const res = await fetch(`${apiUrl}/v1/audio/transcriptions`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`STT error: ${res.status}`);
  const data = (await res.json()) as { text: string };
  return data.text.trim();
}
```

**Step 3: Start Parakeet**

Run: `docker compose up parakeet-stt -d`

**Step 4: Commit**

```bash
git add docker-compose.yml src/stt/parakeet.ts
git commit -m "feat: parakeet STT docker and client"
```

---

### Task 17: Voice Handler

**Files:**
- Create: `src/bot/handlers/voice.ts`
- Modify: `src/index.ts`

**Step 1: Voice handler**

`src/bot/handlers/voice.ts`:
```typescript
import type { Context } from "grammy";
import type { Config } from "../../config";
import { transcribeAudio } from "../../stt/parakeet";
import { getSessionKey } from "../session";
import type { Debouncer } from "../middleware/debounce";
import { mkdirSync, unlinkSync } from "fs";
import { join } from "path";

const TMP = join(import.meta.dir, "../../.tmp");
mkdirSync(TMP, { recursive: true });

export function createVoiceHandler(
  config: Config,
  debouncer: Debouncer,
  ctxMap: Map<string, Context>
) {
  return async (ctx: Context): Promise<void> => {
    const voice = ctx.message?.voice;
    if (!voice) return;
    const key = getSessionKey(ctx);
    ctxMap.set(key, ctx);

    try {
      const file = await ctx.getFile();
      const url = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
      const buf = await (await fetch(url)).arrayBuffer();

      const ogg = join(TMP, `${voice.file_unique_id}.ogg`);
      const wav = join(TMP, `${voice.file_unique_id}.wav`);
      await Bun.write(ogg, buf);

      // Convert OGG to WAV 16kHz mono using Bun.spawn
      const ffmpeg = Bun.spawn({
        cmd: ["ffmpeg", "-loglevel", "error", "-y", "-i", ogg, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav],
      });
      await ffmpeg.exited;

      const transcript = await transcribeAudio(wav, config.parakeetUrl);

      // Show italic transcript
      const threadId = (ctx.message as any)?.message_thread_id;
      const opts: any = { parse_mode: "Markdown" };
      if (threadId && threadId !== 1) opts.message_thread_id = threadId;
      await ctx.api.sendMessage(ctx.chat!.id, `_${transcript}_`, opts);

      debouncer.add(key, transcript);

      try { unlinkSync(ogg); unlinkSync(wav); } catch {}
    } catch (err) {
      console.error("Voice error:", err);
      await ctx.reply("Could not process voice message.");
    }
  };
}
```

**Step 2: Wire into index.ts**

```typescript
import { createVoiceHandler } from "./bot/handlers/voice";
// After setupMessageHandler returns { debouncer, ctxMap }:
bot.on("message:voice", createVoiceHandler(config, debouncer, ctxMap));
```

**Step 3: Test — send voice in Telegram**

**Step 4: Commit**

```bash
git add src/bot/handlers/voice.ts src/index.ts
git commit -m "feat: voice handler with parakeet STT"
```

---

## Phase 4: Scheduling

### Task 18: Task CRUD

**Files:**
- Create: `src/scheduler/tasks.ts`
- Create: `src/scheduler/tasks.test.ts`

**Step 1: Write failing test**

`src/scheduler/tasks.test.ts`:
```typescript
import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initSchema } from "../db/schema";
import { TaskRepo } from "./tasks";

describe("TaskRepo", () => {
  let repo: TaskRepo;
  beforeEach(() => {
    const db = new Database(":memory:");
    initSchema(db);
    repo = new TaskRepo(db);
  });

  test("create and get", () => {
    repo.create({ id: "t1", what: "Check Gmail", schedule: "0 */2 * * *", urgency: "high", deliver_to: "dm", status: "active" });
    expect(repo.get("t1")!.what).toBe("Check Gmail");
  });

  test("listActive", () => {
    repo.create({ id: "t1", what: "A", schedule: "* * * * *", urgency: "low", deliver_to: "dm", status: "active" });
    repo.create({ id: "t2", what: "B", schedule: "* * * * *", urgency: "low", deliver_to: "dm", status: "completed" });
    expect(repo.listActive().length).toBe(1);
  });

  test("updateStatus", () => {
    repo.create({ id: "t1", what: "A", schedule: "* * * * *", urgency: "low", deliver_to: "dm", status: "active" });
    repo.updateStatus("t1", "completed");
    expect(repo.get("t1")!.status).toBe("completed");
  });
});
```

**Step 2: Run — expected FAIL**

**Step 3: Implement**

`src/scheduler/tasks.ts`:
```typescript
import type { Database } from "bun:sqlite";

export interface ScheduledTask {
  id: string; what: string; schedule: string;
  until_condition?: string | null; urgency: "low" | "medium" | "high" | "critical";
  deliver_to: string; quiet_start?: string | null; quiet_end?: string | null;
  quiet_action?: "skip" | "queue"; status: "active" | "paused" | "completed";
  created_at?: string; last_run_at?: string | null; next_run_at?: string | null;
}

type CreateInput = Pick<ScheduledTask, "id" | "what" | "schedule" | "urgency" | "deliver_to" | "status"> & Partial<ScheduledTask>;

export class TaskRepo {
  constructor(private db: Database) {}

  create(t: CreateInput): void {
    this.db.prepare(
      `INSERT INTO tasks (id,what,schedule,until_condition,urgency,deliver_to,quiet_start,quiet_end,quiet_action,status)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(t.id, t.what, t.schedule, t.until_condition ?? null, t.urgency, t.deliver_to,
      t.quiet_start ?? null, t.quiet_end ?? null, t.quiet_action ?? "queue", t.status);
  }

  get(id: string): ScheduledTask | null {
    return this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as ScheduledTask | null;
  }

  listActive(): ScheduledTask[] {
    return this.db.prepare("SELECT * FROM tasks WHERE status = 'active'").all() as ScheduledTask[];
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare("UPDATE tasks SET status = ? WHERE id = ?").run(status, id);
  }

  markRun(id: string): void {
    this.db.prepare("UPDATE tasks SET last_run_at = datetime('now') WHERE id = ?").run(id);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }
}
```

**Step 4: Run — expected PASS**

**Step 5: Commit**

```bash
git add src/scheduler/
git commit -m "feat: scheduled task CRUD"
```

---

### Task 19: Scheduler Engine

**Files:**
- Create: `src/scheduler/engine.ts`
- Modify: `src/index.ts`

**Step 1: Write engine**

`src/scheduler/engine.ts`:
```typescript
import { Cron } from "croner";
import PQueue from "p-queue";
import type { Config } from "../config";
import type { Database } from "bun:sqlite";
import { TaskRepo, type ScheduledTask } from "./tasks";
import { runClaude } from "../claude/runner";

export class Scheduler {
  private jobs = new Map<string, Cron>();
  private queue: PQueue;
  private repo: TaskRepo;

  constructor(
    private config: Config,
    db: Database,
    private deliverFn: (to: string, text: string) => Promise<void>
  ) {
    this.repo = new TaskRepo(db);
    this.queue = new PQueue({ concurrency: 1 });
  }

  async queueInteractive<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.add(fn, { priority: 10 }) as Promise<T>;
  }

  start(): void {
    const tasks = this.repo.listActive();
    for (const t of tasks) this.registerJob(t);
    console.log(`Scheduler: ${tasks.length} active tasks`);
  }

  registerJob(task: ScheduledTask): void {
    this.jobs.get(task.id)?.stop();
    const job = new Cron(task.schedule, {
      timezone: "Europe/Belgrade", protect: true,
    }, () => {
      this.queue.add(() => this.execute(task), { priority: 1 });
    });
    this.jobs.set(task.id, job);
  }

  private async execute(task: ScheduledTask): Promise<void> {
    const fresh = this.repo.get(task.id);
    if (!fresh || fresh.status !== "active") return;

    if (this.isQuiet(fresh) && fresh.quiet_action === "skip") return;

    const prompt = `Scheduled task: ${fresh.what}${
      fresh.until_condition ? `\nAuto-complete when: ${fresh.until_condition}\nIf condition met, start with "CONDITION_MET:"` : ""
    }\nExecute now and report status.`;

    let result = "";
    try {
      for await (const ev of runClaude({ prompt, workspacePath: this.config.workspacePath, timeoutMs: 180_000 })) {
        if (ev.type === "text") result += ev.content;
      }
    } catch (err) { result = `Error: ${err}`; }

    this.repo.markRun(task.id);

    if (fresh.until_condition && result.includes("CONDITION_MET:")) {
      this.repo.updateStatus(task.id, "completed");
      this.jobs.get(task.id)?.stop();
      this.jobs.delete(task.id);
    }

    await this.deliverFn(fresh.deliver_to, result);
  }

  private isQuiet(t: ScheduledTask): boolean {
    if (!t.quiet_start || !t.quiet_end || t.urgency === "critical") return false;
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const [sH, sM] = t.quiet_start.split(":").map(Number);
    const [eH, eM] = t.quiet_end.split(":").map(Number);
    const start = sH * 60 + sM, end = eH * 60 + eM;
    return start <= end ? cur >= start && cur < end : cur >= start || cur < end;
  }

  stop(): void { for (const j of this.jobs.values()) j.stop(); this.jobs.clear(); }
}
```

**Step 2: Wire into index.ts**

Add delivery function + scheduler start. Add `/tasks` command:
```typescript
import { Scheduler } from "./scheduler/engine";
import { TopicRepo, TaskRepo as TR } from "./db/client"; // TopicRepo for delivery

// Delivery:
const topicRepo = new TopicRepo(db);
async function deliver(to: string, text: string) {
  if (to === "dm") { await bot.api.sendMessage(config.telegramUserId, text); return; }
  if (to.startsWith("topic:") && config.telegramForumChatId) {
    const tid = topicRepo.getThreadId(to.slice(6), config.telegramForumChatId);
    const opts: any = {};
    if (tid && tid !== 1) opts.message_thread_id = tid;
    await bot.api.sendMessage(config.telegramForumChatId, text, opts);
    return;
  }
  await bot.api.sendMessage(config.telegramUserId, text);
}

const scheduler = new Scheduler(config, db, deliver);
scheduler.start();

// /tasks command
bot.command("tasks", async (ctx) => {
  const repo = new TR(db);
  const active = repo.listActive();
  if (!active.length) { await ctx.reply("No active tasks."); return; }
  const lines = active.map(t => `- ${t.what} (${t.urgency}) → ${t.deliver_to} | \`${t.schedule}\``);
  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
});
```

**Step 3: Test — create task via chat, verify it fires**

**Step 4: Commit**

```bash
git add src/scheduler/engine.ts src/index.ts
git commit -m "feat: scheduler with croner, p-queue, and delivery"
```

---

## Phase 5: Polish & Safety

### Task 20: Watchdog + Graceful Shutdown

**Files:**
- Create: `src/watchdog.ts`
- Modify: `src/index.ts`

**Step 1: Watchdog**

`src/watchdog.ts`:
```typescript
export function startWatchdog(): Timer {
  const botPid = process.pid;
  return setInterval(async () => {
    try {
      const proc = Bun.spawn({ cmd: ["pgrep", "-f", "claude.*stream-json"], stdout: "pipe" });
      const text = await new Response(proc.stdout).text();
      const pids = text.trim().split("\n").filter(Boolean).map(Number);
      for (const pid of pids) {
        if (isNaN(pid)) continue;
        const pp = Bun.spawn({ cmd: ["ps", "-o", "ppid=", "-p", String(pid)], stdout: "pipe" });
        const ppid = Number((await new Response(pp.stdout).text()).trim());
        if (ppid !== botPid && ppid > 1) {
          console.warn(`Killing orphan claude pid ${pid}`);
          process.kill(pid, "SIGKILL");
        }
      }
    } catch {}
  }, 60_000);
}
```

**Step 2: Wire in + shutdown**

```typescript
import { startWatchdog } from "./watchdog";
// At end of main():
startWatchdog();

const shutdown = () => { console.log("Shutting down..."); scheduler.stop(); bot.stop(); db.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("unhandledRejection", (e) => console.error("Unhandled:", e));
```

**Step 3: Commit**

```bash
git add src/watchdog.ts src/index.ts
git commit -m "feat: orphan watchdog and graceful shutdown"
```

---

### Task 21: Final Integration Test

**No new files — manual testing checklist:**

1. `docker compose up parakeet-stt -d` — Parakeet running
2. `bun run src/index.ts` — bot starts, "Kuzma online." received
3. DM text → Claude responds with streaming
4. Send 3 quick messages → debounced into one
5. Voice message → italic transcript + response
6. Forum topic → separate Claude session
7. `/new` → fresh session
8. `/stop` → aborts running request
9. Claude triggers ask_user → inline buttons appear → tap → Claude gets answer
10. `/tasks` → shows active tasks
11. Kill bot → `pm2 restart kuzma` → sessions preserved in SQLite

**Final commit:**
```bash
git add -A && git commit -m "chore: integration complete"
```

---

## Verification Checklist

- [ ] `bun test` — all unit tests pass
- [ ] Bot responds in DM with streaming text
- [ ] Debounce combines rapid messages
- [ ] Voice transcription works (Parakeet)
- [ ] Forum topics have separate sessions
- [ ] `/new` and `/stop` commands work
- [ ] ask_user MCP shows inline buttons
- [ ] Scheduled tasks fire and deliver
- [ ] Orphan watchdog active
- [ ] pm2 restart preserves state
