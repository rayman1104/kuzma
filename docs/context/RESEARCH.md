# Deep technical research for Кузьма: personal AI Telegram assistant

**Claude Code running as a local agent on your machine, accessible via Telegram, represents a powerful but architecturally nuanced setup.** The core challenge: the Claude Agent SDK spawns a fresh CLI child process per `query()` call (~12s overhead), requires API key authentication (not Pro/Max subscription), and runs with full system access unless explicitly sandboxed. This document covers every implementation detail across eight research areas — from SDK internals and Takopi's bridge patterns to forum topic routing and Russian STT deployment.

The architectural reference point combines **Takopi** (banteg's lightweight CLI bridge with stateless resume) and **OpenClaw** patterns (full-featured personal assistant with memory and scheduling). The optimal design borrows Takopi's normalized event model and stateless session embedding, while adding croner-based scheduling, grammY forum topic routing, and Parakeet v3 for local Russian STT — all wrapped in NanoClaw-style container isolation.

---

## 1. linuz90/claude-telegram-bot — how the SDK wraps the CLI

The reference implementation at [github.com/linuz90/claude-telegram-bot](https://github.com/linuz90/claude-telegram-bot) is a TypeScript/Bun project (~29 stars, MIT license) built on grammY and the Claude Agent SDK. Its architecture reveals the fundamental mechanics of SDK-to-CLI communication.

### Process spawning mechanism

The `@anthropic-ai/claude-agent-sdk` does **not** call the Anthropic API directly. It bundles a pre-compiled `cli.js` (~9.6 MB) and spawns it as a child process via Node.js `child_process.spawn()`. The `ProcessTransport` class inside `sdk.mjs` manages lifecycle:

```typescript
// SDK internals (from sdk.mjs):
pathToClaudeCodeExecutable = join3(dirname2, "cli.js");
this.child = spawn(spawnCommand, spawnArgs, { /* options */ });

// Resulting command:
node /path/to/node_modules/@anthropic-ai/claude-agent-sdk/cli.js \
  --output-format stream-json \
  --verbose \
  --input-format stream-json \
  --system-prompt "..." \
  --max-turns 10 \
  --permission-mode bypassPermissions \
  --setting-sources user,project \
  --allowedTools Read,Grep,Bash,WebSearch,WebFetch
```

Communication uses **stream-JSON over stdin/stdout** — a bidirectional IPC protocol where both SDK and CLI can initiate requests. Each `query()` call spawns a fresh process with **~12 seconds of initialization overhead** (down from ~40s in older versions, per [GitHub issue #34](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34)). No hot process reuse exists yet.

### MCP server inheritance via settingSources

The `settingSources` option controls which filesystem configs load automatically:

```typescript
options: {
  settingSources: ['user', 'project'],
  // 'user'    → ~/.claude/settings.json (MCP servers, permissions)
  // 'project' → .claude/settings.json in working directory
  // 'local'   → .claude/settings.local.json
}
```

When `settingSources` includes `'user'`, the SDK reads `~/.claude/settings.json` and inherits **all** MCP servers configured via `claude mcp add`. The bot also supports a `mcp-config.local.ts` file for bot-specific servers, merged at runtime.

### ask_user MCP server — inline keyboards

The `ask_user_mcp/` directory implements an in-process MCP server using the SDK's `createSdkMcpServer` and `tool` APIs. It lets Claude present tappable inline keyboard buttons in Telegram:

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

const askUserTool = tool(
  'ask_user',
  'Present options as inline keyboard buttons',
  z.object({
    question: z.string(),
    options: z.array(z.string()),
  }),
  async (args) => {
    // Communicates with bot.ts to send InlineKeyboard, waits for callback
    const userResponse = await waitForUserSelection(args.question, args.options);
    return { content: [{ type: 'text', text: userResponse }] };
  }
);

const askUserMcpServer = createSdkMcpServer({
  name: 'ask_user', version: '1.0.0', tools: [askUserTool],
});

// Passed to query() as an in-process server:
mcpServers: { ask_user: askUserMcpServer }
```

The Telegram side handles `callback_query:data` events, resolves pending Promises keyed by chat ID, and calls `ctx.answerCallbackQuery()`.

### Session management and streaming

Sessions use the SDK's `sessionId` / `resume` mechanism. The `init` system message yields a `session_id` to capture; passing it back to a subsequent `query()` call resumes the conversation. Sessions persist on disk at `~/.claude/projects/<folder-slug>/<session-id>.jsonl`.

Streaming works through the `query()` AsyncGenerator, which yields typed messages (`assistant`, `tool_use`, `result`). The bot accumulates text chunks and periodically calls `editMessageText` to create a streaming effect, throttled to avoid Telegram's ~30 messages/second rate limit. Messages exceeding **4096 characters** split into multiple Telegram messages.

### Handler architecture

The bot uses grammY's middleware pattern with a clear routing hierarchy:

```typescript
// Authentication middleware (user allowlist)
bot.use(authMiddleware);  // TELEGRAM_ALLOWED_USERS env var

// Commands
bot.command('new', handleNew);       // Fresh session
bot.command('resume', handleResume); // Resume last session
bot.command('stop', handleStop);     // AbortController.abort()

// Message type routing
bot.on('message:text', handleTextMessage);
bot.on('message:voice', handleVoiceMessage);     // → OpenAI Whisper → Claude
bot.on('message:photo', handlePhotoMessage);      // → Claude vision
bot.on('message:document', handleDocumentMessage); // Extract → Claude
bot.on('callback_query:data', handleCallbackQuery); // ask_user buttons
```

Voice transcription uses OpenAI's Whisper API (`OPENAI_API_KEY` required). The bot downloads OGG from Telegram, sends to Whisper, and forwards the text to Claude. A notable related project is [NachoSEO/claudegram](https://github.com/NachoSEO/claudegram), which adds a request queue, agent watchdog, and separate handler files per message type.

---

## 2. Claude Agent SDK — real-world limits and critical gotchas

### Authentication: SDK requires API keys, not subscriptions

**The single most important constraint**: the Claude Agent SDK requires `ANTHROPIC_API_KEY` (pay-per-token). Anthropic explicitly prohibits using Pro/Max subscription OAuth tokens with the SDK. From the [official legal page](https://code.claude.com/docs/en/legal-and-compliance) (updated Feb 19, 2026): *"OAuth authentication is intended exclusively for Claude Code and Claude.ai. Using OAuth tokens in any other product — including the Agent SDK — is not permitted."*

### Rate limits by plan type

For **API key** usage (the only SDK-compatible auth):

| Tier | Deposit | RPM | Input TPM | Output TPM |
|------|---------|-----|-----------|------------|
| Tier 1 | $5 | Low | Low | Low |
| Tier 2 | $40 | Medium | Medium | Medium |
| Tier 3 | $200 | Higher | Higher | Higher |
| Tier 4 | $400 | Highest | Highest | Highest |

For reference, Claude Code **subscription** limits (CLI only, not SDK): Pro ($20/mo) gives ~10–40 prompts per 5-hour window; Max 5x ($100/mo) gives ~50–200; Max 20x ($200/mo) gives ~200–800. Weekly caps were introduced August 28, 2025.

### Compaction behavior

Auto-compaction triggers when context reaches approximately **75–95% capacity** (newer reports suggest ~64–75% to preserve a completion buffer). The process: a summary prompt injects as a user turn → Claude generates a `<summary>` → the SDK replaces the entire message history with the summary.

**What survives**: key decisions, recent code snippets, overall task context. **What's lost**: detailed tool outputs, file contents from early reads, specific early-conversation instructions. After compaction, Claude frequently re-reads files it already processed.

**Protection strategies**: (1) **CLAUDE.md** files load from disk each turn, surviving compaction — put all persistent rules there. (2) Manual `/compact focus on X` to guide preservation. (3) **Subagents** get their own fresh 200K context. (4) Server-side compaction with `compact_20260112` strategy and `pause_after_compaction: true`.

### maxBudgetUsd — post-turn enforcement only

Budget is tracked via `total_cost_usd` in the result message. It checks **after** each turn completes — a single expensive turn can exceed the budget. The SDK emits `subtype: 'error_max_budget_usd'` when exceeded. No pre-execution validation occurs.

### Top GitHub issues (real-world gotchas)

- **[#34](https://github.com/anthropics/claude-agent-sdk-typescript/issues/34)**: ~12s overhead per `query()` call (process spawn)
- **[#142](https://github.com/anthropics/claude-agent-sdk-typescript/issues/142)**: Orphaned processes accumulate if parent dies — each consuming 50–100MB RAM. One user observed **47 orphaned processes (~3GB)** after 24 hours
- **[#138](https://github.com/anthropics/claude-agent-sdk-typescript/issues/138)**: "Prompt is too long" permanently breaks a session — even `/compact` fails
- **[#55](https://github.com/anthropics/claude-agent-sdk-typescript/issues/55)**: `spawn node ENOENT` after updates — PATH not set in spawned process
- **[#20](https://github.com/anthropics/claude-agent-sdk-typescript/issues/20)**: WSL2 crashes immediately — binary incompatibility
- **[#29](https://github.com/anthropics/claude-agent-sdk-typescript/issues/29)**: `allowedTools`/`disallowedTools` not enforced in `--continue` mode
- **[#36](https://github.com/anthropics/claude-agent-sdk-typescript/issues/36)**: Skills not discovered via SDK despite correct `settingSources`
- **[#11](https://github.com/anthropics/claude-agent-sdk-typescript/issues/11)**: Explicit confirmation that Max subscription cannot be used with SDK

**Orphaned process cleanup** is critical for always-on bots:
```bash
pgrep -f "claude.*--output-format.*stream-json" | xargs kill
```

### Session persistence

Sessions are stored as JSONL at `~/.claude/projects/<folder-slug>/<session-id>.jsonl`. Each line is a JSON object representing a message, tool call, or result. Resume via:

```typescript
// Capture session_id from init message
for await (const msg of query({ prompt: "Hello", options: {} })) {
  if (msg.type === "system" && msg.subtype === "init") {
    sessionId = msg.session_id;
  }
}
// Resume later
const resumed = query({ prompt: "Continue", options: { resume: sessionId } });
```

Recommended hosting resources per Anthropic: **1 GiB RAM, 5 GiB disk, 1 CPU** per session.

---

## 3. CLIProxyAPI and subscription-as-API tools

### The proxy ecosystem

A large ecosystem of tools exists for routing API calls through Claude subscription auth. The dominant tool is **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** (~12,400 stars, Go): it captures OAuth tokens and exposes OpenAI-compatible endpoints at `localhost:8317`. Others include:

| Tool | Approach | API Format | ToS Status |
|------|----------|------------|------------|
| **CLIProxyAPI** | OAuth token extraction | OpenAI-compatible | ❌ Violates ToS |
| **[claude-max-api-proxy](https://github.com/atalovesyou/claude-max-api-proxy)** | CLI subprocess spawning | OpenAI-compatible | ⚠️ Gray area |
| **[horselock/claude-code-proxy](https://github.com/horselock/claude-code-proxy)** | PKCE OAuth reimplementation | Anthropic native | ❌ Violates ToS |
| **[ccproxy](https://github.com/mergd/ccproxy)** (Cursor-focused) | OAuth + API fallback | OpenAI-compatible | ❌ Violates ToS |

### Anthropic's explicit prohibition (February 2026)

As of **February 19, 2026**, Anthropic explicitly prohibited these tools. From the official docs: *"Anthropic does not permit third-party developers to offer Claude.ai login or to route requests through Free, Pro, or Max plan credentials."* Accounts have been banned. Anthropic engineer Thariq Shihipar confirmed steps to prevent third-party tools from "spoofing the Claude Code harness."

### Three technical patterns

1. **OAuth token extraction** (CLIProxyAPI): Captures tokens, makes direct API calls. Requires Claude Code system prompt prefix or requests are rejected. Most clearly violates ToS.
2. **CLI subprocess spawning** (claude-max-api-proxy): Spawns `claude` CLI per request, parses stdout. Higher latency, doesn't stream character-by-character. Gray area — technically uses Claude Code itself.
3. **PKCE OAuth reimplementation**: Implements full OAuth 2.0 flow independently. No Claude Code installation needed. Most sophisticated but most clearly a violation.

**Practical reality for Кузьма**: Use the Claude Agent SDK with API keys. The SDK is the official programmatic interface. For a personal single-user bot, API costs at Tier 1–2 are manageable. The risk of account bans from proxy tools makes them unsuitable for a reliable personal assistant.

---

## 4. Takopi — the bridge architecture worth borrowing

**[Takopi](https://github.com/banteg/takopi)** (709 stars, MIT license) by banteg (Yearn Finance developer) is a Python Telegram bridge for multiple coding agents — Claude Code, Codex, OpenCode, and Pi. Published January 2026, it represents the cleanest architecture for wrapping CLI agents.

### Core architecture

```
Telegram ← long polling → Takopi Core
    ↕                        ↕
 Parse/Render          Auto-Router (engine selection, resume extraction)
                            ↕
                    Runner Protocol
                 ┌─────┬──────┬──────┐
               Claude  Codex  OpenCode  Pi   ← CLI subprocesses
                 ↕
           Normalized TakopiEvent Stream
           (StartedEvent → ActionEvent* → CompletedEvent)
                 ↕
           ProgressRenderer → Telegram message edits
```

### Six patterns worth borrowing

**Pattern 1: Runner Protocol.** All engines implement a single protocol: `run(prompt, resume) → AsyncIterator[TakopiEvent]`. This completely decouples the agent engine from the messaging transport. For Кузьма, define a TypeScript interface:

```typescript
interface Runner {
  engine: string;
  run(prompt: string, resume?: string): AsyncGenerator<KuzmaEvent>;
  extractResume(text: string): string | null;
}
```

**Pattern 2: Normalized event system.** All runner outputs map to `StartedEvent` → `ActionEvent` (phases: started/updated/completed, kinds: command/file_change/tool/web_search/warning) → `CompletedEvent`. The renderer doesn't need to know about specific engines.

**Pattern 3: Stateless resume.** **No database needed.** Session IDs embed in every bot response as resume lines (e.g., `` `claude --resume 8b2d2b30-...` ``). When a user replies to a message containing a resume line, Takopi extracts the token and resumes that session. Three modes: reply-to-continue, forum topics (per-topic JSON state), chat sessions (per-chat JSON state).

**Pattern 4: Telegram scheduled messages as cron.** Instead of building an internal scheduler, Takopi leverages Telegram's native scheduled message feature. When a scheduled message fires, it's processed like any regular message. Zero infrastructure.

**Pattern 5: Per-session serialization.** Strict serial execution within a thread (same resume token) but parallel runs across different threads. Implemented via `anyio.Lock` keyed by `engine:session_id`.

**Pattern 6: Git worktree isolation.** For coding tasks, creating git worktrees lets multiple branches run agents in parallel without interference.

### Takopi vs OpenClaw

| Dimension | Takopi | OpenClaw |
|-----------|--------|----------|
| Lines of code | ~few thousand | 430,000+ |
| Architecture | Thin bridge/proxy | Monolithic gateway |
| Memory system | Stateless (delegates to engines) | MEMORY.md + daily logs + vector search |
| Scheduling | Telegram native scheduled messages | Built-in cron/heartbeat |
| Security attack surface | Minimal (just a bridge) | Broad (full system access + plugins) |

The Claude runner spawns: `claude -p --output-format stream-json --verbose -- "prompt"`. Notably, Takopi **strips `ANTHROPIC_API_KEY`** from the subprocess environment to force subscription billing over API billing.

### Related projects worth studying

- **[Nanobot](https://github.com/HKUDS/nanobot)** (~20K stars): ~4,000 lines of Python, persistent markdown memory, scheduled tasks, 11+ LLM providers, Telegram/Discord/WhatsApp support
- **[NanoClaw](https://github.com/qwibitai/nanoclaw)**: Container-isolated agents, Claude Agent SDK-based, "skills over features" philosophy
- **[ClaudeClaw](https://github.com/moazbuilds/claudeclaw)**: Lightweight OpenClaw variant as Claude Code plugin with daemon, scheduling, and Telegram

---

## 5. Scheduling — croner + p-queue + better-sqlite3

### Library comparison for TypeScript

| Feature | **croner** | **node-cron** | **bullmq** | **agenda v6** | **toad-scheduler** |
|---------|-----------|--------------|-----------|--------------|-------------------|
| Cron syntax | Extended (sec, year, L, W, #) | Standard + seconds | Standard | Cron + human-readable | Via croner |
| Timezone | ✅ `timezone: "Europe/Moscow"` | ✅ | ✅ | ✅ | Via croner |
| Persistence | ❌ In-memory | ❌ In-memory | ✅ Redis | ✅ MongoDB/PG/Redis | ❌ In-memory |
| Missed job recovery | ❌ | ✅ `recoverMissedExecutions` | ✅ | ✅ | ❌ |
| Overrun protection | ✅ `protect: true` | ❌ | ✅ | ✅ | ✅ |
| Dependencies | **0** | **0** | Redis server | DB server | 1 (croner) |
| TypeScript | ✅ Native | ⚠️ @types | ✅ Native | ✅ Native (v6) | ✅ Native |

**Recommendation: croner** for scheduling, **p-queue** (concurrency: 1) for serial Claude task execution, **better-sqlite3** for persistence.

### Core implementation pattern

```typescript
import { Cron } from 'croner';
import PQueue from 'p-queue';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Serial execution queue — only one Claude task at a time
const taskQueue = new PQueue({ concurrency: 1 });

// Scheduled task with timezone
const morningBriefing = new Cron('0 9 * * *', {
  timezone: 'Europe/Moscow',
  protect: true,  // Prevent overlapping executions
}, () => {
  taskQueue.add(async () => {
    const result = await runClaude('Generate morning briefing...');
    await bot.api.sendMessage(CHAT_ID, `📋 ${result}`);
  }, { priority: 1 });  // Lower priority than on-demand
});

// On-demand tasks get higher priority
bot.on('message:text', async (ctx) => {
  const resultPromise = taskQueue.add(
    () => runClaude(ctx.message.text),
    { priority: 0 }  // Higher priority (lower = higher in p-queue)
  );
  const result = await resultPromise;
  await ctx.reply(result);
});
```

### CONDITION_MET pattern

Schedule periodic checks that silently evaluate conditions and trigger actions only when met:

```typescript
const weatherCheck = new Cron('*/30 * * * *', {
  timezone: 'Europe/Moscow', protect: true,
}, async () => {
  const check = await runClaude(`
    Check Moscow weather API. Respond JSON only:
    { "conditionMet": boolean, "details": string }
    Condition: rain in next 2 hours?
  `);
  const parsed = JSON.parse(check);
  if (parsed.conditionMet) {
    await bot.api.sendMessage(CHAT_ID, `🌧 ${parsed.details}`);
  }
});
```

### Persistence with SQLite

Store task definitions in better-sqlite3. On startup, restore all enabled tasks and re-register with croner. For missed job recovery: query SQLite for tasks whose `last_run` is older than their cron interval predicts, and execute them immediately before starting regular scheduling. This is a ~20-line custom implementation that replaces node-cron's `recoverMissedExecutions` while keeping croner's superior feature set.

---

## 6. grammY forum topics — routing and session management

### Built-in auto-thread support (v1.38.2+)

As of **grammY v1.38.2**, `ctx.reply()` automatically targets the correct forum topic. The `@grammyjs/auto-thread` plugin is archived. Use grammY **v1.38.4+** for full support including `sendChatAction` in threads.

### The General topic trap

The General topic (`id = 1`) is the primary source of bugs:

- Messages in General do **NOT** have `is_topic_message: true`
- `message_thread_id` may be absent or contain a reply-thread ID (not a valid topic)
- **Telegram rejects `sendMessage` with `message_thread_id=1`** — you must omit the parameter entirely
- There's no `getForumTopics` API method — topic names are only available in `forum_topic_created` service messages

**Safe send function:**
```typescript
async function sendToTopic(bot: Bot, chatId: number, topicId: number | undefined, text: string) {
  const options: Record<string, unknown> = {};
  if (topicId && topicId !== 1) {  // Never pass 1 for General
    options.message_thread_id = topicId;
  }
  try {
    return await bot.api.sendMessage(chatId, text, options);
  } catch (error) {
    if (error instanceof GrammyError && error.description.includes("message thread not found")) {
      return await bot.api.sendMessage(chatId, text);  // Fallback to General
    }
    throw error;
  }
}
```

### Topic-based session keys

Customize the session key to include `message_thread_id` for per-topic state:

```typescript
function getSessionKey(ctx: Context): string | undefined {
  const chatId = ctx.chat?.id;
  if (!chatId) return undefined;
  const msg = ctx.message ?? ctx.callbackQuery?.message;
  const threadId = msg?.message_thread_id;
  const isTopicMessage = msg && "is_topic_message" in msg && msg.is_topic_message;

  if (isTopicMessage && threadId) return `${chatId}/${threadId}`;
  if (ctx.chat && "is_forum" in ctx.chat && ctx.chat.is_forum) return `${chatId}/general`;
  return chatId.toString();
}

bot.use(session({ initial: () => ({ sessionId: null }), getSessionKey }));
```

### Topic-based routing with Router plugin

```typescript
import { Router } from "@grammyjs/router";

const topicRouter = new Router<MyContext>((ctx) => {
  const threadId = ctx.message?.message_thread_id;
  if (!threadId) return "general";
  const routes: Record<number, string> = { 2: "commands", 15: "logs", 28: "chat" };
  return routes[threadId] ?? "unknown";
});

topicRouter.route("commands", (ctx) => ctx.reply("Command handler"));
topicRouter.route("logs", (ctx) => ctx.reply("Log handler"));
topicRouter.route("chat", (ctx) => ctx.reply("Chat handler"));
bot.on("message", topicRouter);
```

### Creating topics programmatically

```typescript
const commandsTopic = await ctx.api.createForumTopic(chatId, "🤖 Commands", {
  icon_color: 0x6FB9F0,  // Blue
});
await ctx.api.sendMessage(chatId, "Send commands here!", {
  message_thread_id: commandsTopic.message_thread_id,
});
```

Valid icon colors: `0x6FB9F0` (blue), `0xFFD67E` (yellow), `0xCB86DB` (purple), `0x8EEE98` (green), `0xFF93B2` (pink), `0xFB6F5F` (red).

---

## 7. Parakeet v3 STT — excellent Russian at CPU speed

### The right model: parakeet-tdt-0.6b-v3

**There is no 1.1B v3 multilingual model.** The **parakeet-tdt-0.6b-v3** (600M params, released August 2025) is the only multilingual TDT variant. It supports **25 European languages including Russian** with automatic language detection.

Russian benchmarks are excellent: **5.51% WER on FLEURS** and **3.00% WER on CoVoST** — on par with the model's English performance (4.85% FLEURS). The model was trained on the Granary dataset (~660K hours of multilingual speech).

### Performance comparison

| System | 10s audio latency | Russian WER | GPU needed? |
|--------|-------------------|-------------|-------------|
| **Parakeet 0.6B ONNX (CPU)** | ~0.2s | 5.51% FLEURS | No |
| **Parakeet 0.6B ONNX (GPU)** | <0.1s | 5.51% FLEURS | Yes |
| **faster-whisper Large v3 (GPU)** | ~1–2s | ~7–10% | Yes |
| **Whisper Large v3 (CPU)** | ~30–60s | ~7–10% | No |
| **Groq Whisper API** | ~0.5–1.0s (network) | ~7–10% | Cloud |

Parakeet on CPU is **~60x real-time** — a 10-second voice message transcribes in ~0.2 seconds. On GPU it reaches **~3,380x real-time** in batch mode.

### Docker deployment (OpenAI-compatible API)

The community project [groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai](https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai) provides a production-ready Docker setup:

```bash
# CPU deployment (no GPU required)
git clone https://github.com/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai
cd parakeet-tdt-0.6b-v3-fastapi-openai
docker compose up parakeet-cpu -d
# API at localhost:5092
```

The API is **OpenAI-compatible**, meaning it's a drop-in replacement for linuz90's Whisper-based voice handling:

```bash
curl -X POST http://localhost:5092/v1/audio/transcriptions \
  -F "file=@audio.wav" \
  -F "model=parakeet-tdt-0.6b-v3"
```

Memory requirements: **~2 GB RAM** for ONNX INT8 (CPU), **~800 MB** model on disk.

### Telegram voice pipeline in TypeScript

```typescript
import { exec } from "child_process";
import { promisify } from "util";

const asyncExec = promisify(exec);
const STT_URL = process.env.STT_URL || "http://localhost:5092";

// OGG/Opus → WAV 16kHz mono (required by Parakeet)
async function convertOggToWav(input: string, output: string): Promise<void> {
  await asyncExec(
    `ffmpeg -loglevel error -i "${input}" -ar 16000 -ac 1 -c:a pcm_s16le "${output}"`
  );
}

// Transcribe via Parakeet OpenAI-compatible API
async function transcribeAudio(wavPath: string): Promise<string> {
  const form = new FormData();
  form.append("file", Bun.file(wavPath));
  form.append("model", "parakeet-tdt-0.6b-v3");
  const res = await fetch(`${STT_URL}/v1/audio/transcriptions`, {
    method: "POST", body: form,
  });
  return (await res.text()).trim();
}

// Handler
bot.on("message:voice", async (ctx) => {
  const file = await ctx.getFile();
  const url = `https://api.telegram.org/file/bot${TOKEN}/${file.file_path}`;
  // Download → convert → transcribe → send to Claude
  const oggPath = `/tmp/${file.file_id}.ogg`;
  const wavPath = `/tmp/${file.file_id}.wav`;
  // ... download, convert, transcribe, cleanup
});
```

### Docker Compose for full stack

```yaml
services:
  parakeet-stt:
    build:
      context: ./parakeet-tdt-0.6b-v3-fastapi-openai
      dockerfile: Dockerfile.cpu
    ports: ["5092:5092"]
    volumes: [parakeet-models:/app/models]
    restart: unless-stopped

  telegram-bot:
    build: ./telegram-bot
    environment:
      - TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
      - STT_URL=http://parakeet-stt:5092
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    depends_on: [parakeet-stt]
    restart: unless-stopped
```

---

## 8. Security — defense in depth for an always-on agent

### Permission modes

| Mode | What it allows | Risk |
|------|---------------|------|
| `default` | Read-only; all unmatched tools trigger canUseTool callback | Low |
| `acceptEdits` | Auto-approves file edits (Edit, Write, mkdir, rm). Bash still prompts. | Medium |
| `plan` | No tool execution at all. Analysis only. | Minimal |
| `bypassPermissions` | Auto-approves ALL tools. Full system access. | **Critical** |

**Critical warning**: `bypassPermissions` is inherited by **all subagents** and cannot be overridden. Permission bypass bugs have been documented ([issue #26980](https://github.com/anthropics/claude-code/issues/26980)). Read deny rules are "best-effort" — files denied via `Read` can still be accessed via `Bash(cat ...)`.

### The OpenClaw disaster (January 2026)

The most significant documented incident: security researchers found **1,000+ exposed OpenClaw servers**. Key findings:
- **8 instances** had zero authentication, exposing API keys, Telegram tokens, and months of conversation history
- A prompt injection attack **exfiltrated a private SSH key in 5 minutes** — just by sending a crafted email to an address monitored by the agent
- Credentials stored in plaintext. Malware families (RedLine, Lumma) adapted to target OpenClaw directories
- A malicious "skill" was uploaded to the community hub and downloaded by developers from 7 countries

### Sandboxing strategy: container isolation is the hard boundary

**Layer 1 — Claude Code native sandbox** (enable in settings.json):
```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "allowUnsandboxedCommands": false,
    "network": { "allowLocalBinding": false, "allowUnixSockets": [] }
  }
}
```
Uses `bwrap` on Linux, Seatbelt on macOS. Anthropic reports **84% reduction in permission prompts** with sandbox enabled.

**Layer 2 — Docker container** with security constraints:
```yaml
services:
  telegram-agent:
    build: .
    volumes:
      - ./workspace:/workspace  # Only workspace
    read_only: true             # Read-only root filesystem
    tmpfs: ["/tmp:size=100M"]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
    deploy:
      resources:
        limits: { cpus: "2.0", memory: 4G }
```

**Layer 3 — SDK hooks** for security gates and audit logging:

```typescript
const securityGate: HookCallback = async (input) => {
  if (input.hook_event_name !== "PreToolUse") return { continue: true };
  const { tool_name, tool_input } = input;
  
  if (tool_name === "Bash") {
    const BLOCKED = [/rm\s+(-rf|--recursive)/i, /sudo\s/, /\.ssh|\.aws|\.gnupg/];
    const command = (tool_input as { command: string }).command;
    for (const pattern of BLOCKED) {
      if (pattern.test(command)) {
        return { decision: "block", reason: `Blocked: ${pattern}` };
      }
    }
  }
  return { continue: true };
};
```

### Prompt injection threat model for single-user bot

Direct injection risk is low (you're the only user). **Indirect injection** is the real threat: content the bot processes (articles, forwarded messages, files) can contain hidden instructions. Apply Meta's **"Agents Rule of Two"**: if the agent has untrusted data AND tools, don't give it full autonomy — require human approval for high-risk actions.

**Practical mitigations**: (1) Restrict bot to your Telegram user ID. (2) Use `acceptEdits` instead of `bypassPermissions`. (3) System prompt hardening treating all external content as untrusted data. (4) Kill switch via `/kill` command or file-based trigger (`/tmp/agent-kill`). (5) Git checkpoints before destructive operations via PreToolUse hooks. (6) Comprehensive audit logging to JSONL.

### NanoClaw's philosophy (recommended model)

From NanoClaw's security documentation: *"When you're building with AI agents, they should be treated as untrusted and potentially malicious. The right approach isn't better permission checks — it's architecture that assumes agents will misbehave and contains the damage when they do."* NanoClaw uses per-agent containers with mount allowlists stored **outside the project directory** so a compromised agent can't modify its own permissions.

---

## Conclusion: architectural blueprint for Кузьма

The research crystallizes into a clear architecture. Use the **Claude Agent SDK with API keys** (not subscription proxies) wrapped in a **grammY-based Telegram bot** that borrows Takopi's normalized event model and stateless resume pattern. Forum topics in a supergroup provide natural routing — commands, logs, and chat each in their own topic with per-topic session state via custom `getSessionKey`. Schedule tasks with **croner** (zero-dep, timezone-aware, overrun-protected), serialize all Claude work through **p-queue** (concurrency: 1), and persist task definitions in **better-sqlite3**.

For voice, deploy **Parakeet TDT 0.6B v3** via Docker with the ONNX FastAPI wrapper — it handles Russian at 5.51% WER, runs on CPU in ~0.2s per voice message, and exposes an OpenAI-compatible API that's a drop-in replacement for Whisper. Run the entire stack in Docker with read-only filesystem, dropped capabilities, and Claude Code's native sandbox enabled. Use `acceptEdits` permission mode with PreToolUse hooks for security gates and audit logging — never `bypassPermissions` on a host machine. The orphaned process cleanup cron and file-based kill switch round out the operational safety layer.

The **12-second per-query() overhead** is the primary UX bottleneck. For interactive chat this is acceptable; for scheduled tasks it's invisible. The SDK's process-per-query architecture means each conversation turn gets the full Claude Code agent with all tools — not just a chat API wrapper. That's the fundamental value proposition: your Telegram bot runs the same agent that can read files, write code, execute bash, and search the web, all serialized through a priority queue that keeps interactive messages ahead of background tasks.