# Kuzma

Your own Claude in Telegram -- a personal AI assistant with voice messages, forum topics, scheduled tasks, and MCP tool integration.

[![CI](https://github.com/malakhov-dmitrii/kuzma/actions/workflows/ci.yml/badge.svg)](https://github.com/malakhov-dmitrii/kuzma/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Comparison

How Kuzma compares to [OpenClaw](https://github.com/openclaw/openclaw) and [Takopi](https://github.com/banteg/takopi):

| Feature | Kuzma | OpenClaw | Takopi |
|---|---|---|---|
| **Focus** | Telegram-first personal assistant | Multi-platform AI gateway (21+ channels) | Telegram bridge to coding agents |
| **AI backend** | Claude CLI | Claude, ChatGPT, Codex (model failover) | Claude Code, Codex, OpenCode, Pi |
| **Voice messages** | Yes (local Parakeet STT) | Yes (ElevenLabs TTS, transcription hooks) | Yes (Telegram voice notes) |
| **Photo & file handling** | Yes (images, documents with captions) | Media via temp file lifecycle | Files only (send to repo / fetch back) |
| **Forum topics** | Yes (auto-mapped to separate Claude sessions) | Group isolation & activation modes | Yes (topic-to-repo/branch binding) |
| **MCP tools** | Built-in (`ask_user`, `forum`) | Skills platform (bundled + managed) | No |
| **Scheduled tasks** | Yes (cron, urgency levels, quiet hours, auto-completion) | Cron jobs & webhooks | Telegram scheduled messages only |
| **Streaming responses** | Yes (progressive edits, Markdown-to-HTML, chunking) | Tool and block streaming | Progress streaming (commands, tools, file changes) |
| **Session persistence** | SQLite per-topic sessions | Session history with context pruning | Stateless resume (chat or terminal) |
| **Multi-repo / worktrees** | No | Multi-agent routing across workspaces | Yes (git worktrees, parallel runs) |
| **Platforms** | Telegram | Telegram, WhatsApp, Slack, Discord, Signal, iMessage, IRC, Teams, +13 more | Telegram |
| **Native apps** | No | macOS menu bar, iOS, Android | No |
| **Self-hosting** | Docker Compose, single process | Daemon (launchd/systemd), Docker, Nix | CLI tool via `uv` |
| **Runtime** | Bun | Node.js 22+ | Python 3.14+ |
| **Message debouncing** | Yes (configurable delay + max wait) | No | Per-agent-session queue |
| **Auth model** | Owner-only (Telegram user ID) | DM pairing policy, per-session elevated access | Single user |
| **Interactive Q&A** | Yes (inline buttons via MCP) | No | No |
| **Graceful shutdown** | Yes (goodbye message, cleanup) | Daemon lifecycle management | No |

**TL;DR:** Kuzma is optimized for a deep Telegram-native experience with built-in MCP tools and task scheduling. OpenClaw is a broader multi-platform gateway with device apps and 21+ channels. Takopi is developer-focused, bridging Telegram to multiple coding agents with git worktree support.

## Features

- **Claude CLI integration** -- spawns `claude` as a subprocess with streaming JSON output, session persistence, and configurable timeouts
- **Voice messages** -- transcribes Telegram voice messages via a local [Parakeet](https://github.com/NVIDIA/NeMo) STT service (ffmpeg + OpenAI-compatible API)
- **Photo & document handling** -- forwards images and files to Claude with captions as context
- **Forum topics** -- automatically maps Telegram forum topics to separate Claude sessions; each topic gets its own conversation thread
- **Scheduled tasks** -- cron-based task scheduler powered by [Croner](https://github.com/hexagon/croner) with quiet hours, urgency levels, auto-completion conditions, and delivery to DMs or forum topics
- **MCP servers** -- built-in `ask_user` (interactive Q&A via Telegram inline buttons) and `forum` (create/list/send to topics) MCP tools that Claude can call mid-conversation
- **Message debouncing** -- batches rapid-fire messages into a single Claude prompt with configurable delay and max wait
- **Context builder** -- enriches prompts with reply quotes, forward metadata, and thread context
- **Streaming responses** -- progressive message editing in Telegram with Markdown-to-HTML rendering and automatic chunking for long replies
- **Self-healing orchestrator** -- GSD module with pattern-based failure detection and automatic recovery strategies
- **Owner-only auth** -- middleware restricts access to your Telegram user ID
- **Graceful shutdown** -- sends goodbye message, stops scheduler, closes DB on SIGINT/SIGTERM

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.3+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) installed and authenticated
- [ffmpeg](https://ffmpeg.org/) (for voice transcription)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

### Install & Run

```bash
git clone https://github.com/malakhov-dmitrii/kuzma.git
cd kuzma
bun install
```

Copy the example env file and fill in your values:

```bash
cp .env.example .env
```

At minimum, set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_USER_ID`.

Start the bot:

```bash
bun run start
```

For development with hot reload:

```bash
bun run dev
```

## Setup

Kuzma has a two-stage setup process:

### 1. CLI Setup

Run the interactive setup script to create your `.env` file:

```bash
bun run setup
```

This walks you through configuring your Telegram bot token, user ID, and optional paths. It also validates your bot token against the Telegram API.

### 2. Personality Setup (Telegram)

On first start, if no persona is configured, the bot enters onboarding mode in Telegram. It asks you 4 questions:

1. **Language** -- what language the bot should speak
2. **Name** -- what the bot should call itself
3. **Personality** -- a short description of the bot's tone and style
4. **Extra instructions** -- any additional behavior rules (or "skip")

The bot sends your answers to Claude to generate a full persona config (system prompt + all reply strings) and saves it to `data/persona.json`.

To reconfigure the persona, delete `data/persona.json` and restart the bot.

## Configuration

All configuration is done via environment variables. Bun loads `.env` automatically.

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | -- | Bot token from @BotFather |
| `TELEGRAM_USER_ID` | Yes | -- | Your Telegram user ID (owner auth) |
| `PARAKEET_URL` | No | `http://localhost:5092` | Parakeet STT service URL |
| `VAULT_PATH` | No | `~/vault` | Obsidian vault path |
| `WORKSPACE_PATH` | No | `~/workspace` | Workspace path for system prompts (reads `CLAUDE.md` from here) |
| `DB_PATH` | No | `./data/kuzma.db` | SQLite database path |
| `ASK_USER_BRIDGE_PORT` | No | `3847` | HTTP bridge port for MCP servers |

## Voice Transcription

Kuzma uses a local Parakeet STT model for voice-to-text.

The compose service references the image `ghcr.io/groxaxo/parakeet-tdt-0.6b-v3-fastapi-openai:cpu`, but that image is **not published to any registry** — the upstream project only ships a Dockerfile. Build it locally once:

```bash
./scripts/build-parakeet.sh   # clones upstream, patches it, builds & tags the image
```

Then start the service:

```bash
docker compose up parakeet -d
```

This starts a container with the `parakeet-tdt-0.6b-v3` model exposing an OpenAI-compatible `/v1/audio/transcriptions` endpoint on port 5092.

> If `docker compose up parakeet` fails with `error from registry: denied`, the image hasn't been built yet — run `./scripts/build-parakeet.sh`. (It also patches an upstream bug where `Dockerfile.cpu` pins a nonexistent `onnxruntime` version.)

Voice processing pipeline:
1. Telegram sends an OGG voice file
2. Kuzma downloads it and converts to WAV (16kHz mono) via ffmpeg
3. The WAV is sent to Parakeet for transcription
4. The transcript is shown in chat (italic) and forwarded to Claude

## Forum Support

Kuzma supports Telegram forum groups (supergroups with Topics enabled):

1. **Add the bot** to a supergroup with Topics enabled and grant admin rights
2. **Kuzma auto-registers** the group when it detects the join event
3. **Each topic gets its own Claude session** -- conversations are isolated per thread
4. **Claude can create topics** via the built-in `forum` MCP server

Bot commands work both in DMs and forum topics:
- `/new` -- start a fresh Claude session
- `/stop` -- abort the current Claude run
- `/tasks` -- list active scheduled tasks

## Scheduled Tasks

Claude can create and manage scheduled tasks via the task system. Tasks use cron syntax and support:

- **Urgency levels**: `low`, `medium`, `high`, `critical`
- **Delivery targets**: `dm` (direct message) or `topic:<name>` (forum topic)
- **Quiet hours**: skip or queue tasks during specified time windows
- **Auto-completion**: define a condition; when Claude reports `CONDITION_MET:`, the task is automatically completed

Tasks are stored in SQLite and survive restarts. The scheduler polls for new tasks every 30 seconds, so tasks created by Claude during a conversation are picked up automatically.

## Architecture

```
Telegram
  |
  v
grammY bot (auth middleware)
  |
  +-- text handler --> debouncer --> Claude CLI (stream-json)
  +-- voice handler --> ffmpeg --> Parakeet STT --> debouncer
  +-- photo/doc handler --> debouncer
  +-- forum handler --> topic mapping (SQLite)
  +-- callback handler --> ask_user bridge
  |
  v
Claude CLI subprocess
  |
  +-- MCP: ask_user --> HTTP bridge --> Telegram inline buttons
  +-- MCP: forum --> HTTP bridge --> Bot API (create/list/send topics)
  |
  v
TelegramRenderer (streaming edits, Markdown-to-HTML, chunking)
  |
  v
Scheduler (Croner) --> Claude CLI --> deliver to DM / forum topic
```

Key components:

| Module | Path | Purpose |
|---|---|---|
| Bot setup | `src/bot/telegram.ts` | grammY bot creation, middleware |
| Message handler | `src/bot/handlers/message.ts` | Text processing, debouncing, Claude dispatch |
| Voice handler | `src/bot/handlers/voice.ts` | OGG download, ffmpeg, STT, prompt injection |
| Photo handler | `src/bot/handlers/photo.ts` | Image/document forwarding |
| Forum handler | `src/bot/handlers/forum.ts` | Topic auto-mapping, create/get topics |
| Claude runner | `src/claude/runner.ts` | Spawns `claude` CLI, streams events |
| Renderer | `src/claude/renderer.ts` | Progressive Telegram message editing |
| HTML formatter | `src/claude/telegram-format.ts` | Markdown to Telegram HTML conversion |
| Scheduler | `src/scheduler/engine.ts` | Cron-based task execution via Claude |
| ask_user MCP | `src/mcp/ask-user/server.ts` | Interactive Q&A tool for Claude |
| forum MCP | `src/mcp/forum/server.ts` | Topic management tool for Claude |
| GSD orchestrator | `src/gsd/orchestrator.ts` | Self-healing execution with failure recovery |
| Database | `src/db/client.ts` | SQLite repos for sessions, topics, tasks |
| Config | `src/config.ts` | Environment variable loading |

## Docker

Run the full stack with Docker Compose:

```bash
cp .env.example .env
# Edit .env with your tokens

docker compose up -d
```

This starts:
- **kuzma** -- the bot service
- **parakeet** -- local STT model (CPU, ~3 GB RAM)

> **Note:** The Claude CLI must be available inside the container. Mount your Claude config or install it in a custom image.

Build the image manually:

```bash
docker build -t kuzma .
```

## Development

```bash
# Install dependencies
bun install

# Run with hot reload
bun run dev

# Run tests
bun test

# Lint
bun run lint

# Auto-fix lint issues
bun run lint:fix
```

### Project Structure

```
src/
  bot/           # Telegram bot, handlers, middleware, session management
  claude/        # Claude CLI runner, event parser, streaming renderer
  db/            # SQLite database client and schema
  gsd/           # Self-healing orchestrator (Get Stuff Done)
  mcp/           # MCP servers (ask_user, forum)
  scheduler/     # Cron-based task scheduler
  stt/           # Parakeet STT client
  config.ts      # Environment configuration
  persona.ts     # Persona type, loader, and defaults
  index.ts       # Entry point
  watchdog.ts    # Process health monitoring
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, code style, and PR guidelines.

## License

[MIT](LICENSE) -- Dmitrii Malakhov
