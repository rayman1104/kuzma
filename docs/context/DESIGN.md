# Кузьма — Personal AI Assistant via Telegram

> Design Document v1.0 | 2026-02-26

## 1. Vision

Персональный AI-ассистент, доступный через Telegram, с долгосрочной памятью, проактивными задачами и полным доступом к инструментам (email, календарь, браузер, файлы, код). Работает на Claude Code SDK через Pro/Max подписку.

**Ключевой принцип**: ничего не хардкожено — поведение, расписание, quiet hours, urgency — всё настраивается через чат на естественном языке.

---

## 2. Architecture

### 2.1 Base

**Fork [linuz90/claude-telegram-bot](https://github.com/linuz90/claude-telegram-bot)** (TypeScript, grammY, Claude Code SDK).

Почему:
- TypeScript/grammY — наш стек
- Claude Code SDK интеграция уже решена
- ask_user MCP сервер для inline-кнопок из коробки
- Voice через OpenAI Whisper уже реализован
- Чистый, документированный кодбейз
- Недостающее (форум-топики, debounce, scheduling) — ~500 строк кода

### 2.2 High-Level Flow

```
┌──────────────┐     grammY      ┌──────────────┐    Claude Code SDK    ┌──────────────┐
│   Telegram   │ ◄──────────────► │   Bot Node   │ ◄──────────────────► │  Claude Code  │
│  (DM/Forum)  │                 │  (TypeScript) │                      │   (Session)   │
└──────────────┘                 └──────┬───────┘                      └──────┬───────┘
                                        │                                      │
                                        │ read/write                           │ MCP tools
                                        ▼                                      ▼
                                ┌──────────────┐                      ┌──────────────┐
                                │   Obsidian   │                      │  Gmail, GCal  │
                                │    Vault     │                      │  TG Userbot   │
                                │  (Memory)    │                      │  Filesystem   │
                                └──────────────┘                      │  Browser      │
                                                                      └──────────────┘
```

### 2.3 Key Components

```
src/
├── bot/
│   ├── index.ts              # grammY bot init, middleware chain
│   ├── handlers/
│   │   ├── message.ts        # Text message handler + debounce
│   │   ├── voice.ts          # Voice → STT → text pipeline
│   │   ├── callback.ts       # Inline button callbacks
│   │   └── forum.ts          # Forum topic routing
│   ├── middleware/
│   │   ├── auth.ts           # User whitelist check
│   │   ├── debounce.ts       # 2sec timer + concatenation
│   │   └── context.ts        # UserContext injection
│   └── services/
│       ├── claude.ts          # Claude Code SDK wrapper
│       ├── scheduler.ts       # croner-based task engine
│       ├── stt.ts             # Parakeet v3 STT (local, OpenAI-compatible API)
│       └── session.ts         # Session management per topic
├── vault/                     # Obsidian vault operations
│   ├── reader.ts              # Read _system/ files for context
│   ├── writer.ts              # Write daily logs, decisions, etc.
│   └── types.ts
├── types/
│   └── index.ts               # UserContext, Task, etc.
└── config.ts                  # Env vars, paths, constants
```

### 2.4 Multi-User Strategy

Single-user MVP, но `UserContext` abstraction с первого дня:

```typescript
interface UserContext {
  userId: string;
  telegramId: number;
  workspacePath: string;    // ~/workspace
  vaultPath: string;        // ~/vault
  sessionId: string;        // claude code session
  forumChatId?: number;     // forum group id
}
```

Если позже подключится Руслана — добавляем второй UserContext с изолированным vault.

---

## 3. Telegram Setup

### 3.1 Два канала коммуникации

**DM (личный чат)** — быстрые вопросы, мысли, голосовые, "запомни X".

**Forum Group** — отдельная группа с включённым Topics. Каждый проект/область = отдельный топик:
- 📦 RepBoost
- 💰 Budget Vision
- 🔍 Job Search
- 👨‍👩‍👧 Family
- 💵 Finances
- 📺 Ruslana Channel
- 🗓 General / Daily

### 3.2 Topic Routing

Session key: `telegram:{chatId}:topic:{threadId}`

```typescript
function getSessionKey(ctx: Context): string {
  const chatId = ctx.chat!.id;
  const threadId = ctx.message?.message_thread_id ?? 'dm';
  return `telegram:${chatId}:topic:${threadId}`;
}
```

Scheduled tasks доставляются в соответствующий топик. Бот определяет целевой топик по `deliver_to` в задаче.

### 3.3 Forum Topic Edge Cases

- General Topic имеет `message_thread_id = 1` — обрабатывается отдельно
- При создании нового топика — бот автоматически регистрирует маппинг `name → threadId`
- Typing indicator (`sendChatAction`) — обязательно в правильный thread (известный баг OpenClaw)

---

## 4. Memory System

### 4.1 Obsidian Vault Structure

```
vault/
├── _system/                    # ← ВСЕГДА читается при старте сессии
│   ├── SOUL.md                 # Личность, стиль общения, правила
│   ├── MEMORY.md               # Ключевые факты (≤2000 токенов)
│   └── ACTIVE_CONTEXT.md       # Текущий контекст работы
│
├── projects/                   # Активные проекты
│   ├── repboost/
│   │   ├── README.md           # Статус, цели, стек, решения
│   │   └── log.md              # Хронологические действия
│   ├── budget-vision/
│   │   ├── README.md
│   │   └── log.md
│   └── telegram-assistant/
│       ├── README.md
│       └── log.md
│
├── areas/                      # Зоны ответственности (PARA)
│   ├── job-search.md
│   ├── family.md
│   ├── finances.md
│   └── ruslana-channel.md
│
├── daily/                      # Дневные логи (append-only)
│   └── 2026-02-26.md
│
├── decisions/                  # ADR-style записи решений
│   └── 2026-02-use-grammy.md
│
└── inbox/                      # Быстрые заметки для обработки
```

### 4.2 _system/ Files

**SOUL.md** — статичный, редко меняется:
```markdown
# Soul

## Identity
Ты — Кузьма, персональный AI-ассистент Дмитрия. Мастеровой — надёжный, конкретный, без лишних слов.

## Communication Style
- Русский по умолчанию, English для технических тем если уместно
- Кратко и по делу, без воды
- Предлагай лучшие/современные решения сразу
- Если нужно уточнение — спроси, не угадывай

## Rules
- Никогда не удаляй файлы из vault без явного подтверждения
- Всегда обновляй ACTIVE_CONTEXT.md после каждого ответа
- Логируй важные решения в decisions/
- Финансовые данные — только в vault, никуда не отправлять
```

**MEMORY.md** — обновляется по мере накопления фактов:
```markdown
# Memory

## Personal
- Живу в Белграде, Сербия с партнёром Русланой и сыном
- Не ем чеснок и лук (от лука вздутие)
- Православные практики и диета

## Work
- Senior Software Engineer, 8+ лет опыта
- Стек: TypeScript, React, Next.js, Node.js, Drizzle
- Контракт с Amazon, параллельно ищу работу
- Проекты: RepBoost (AI скрининг), Budget Vision (финансы)

## Ruslana
- Telegram-канал "Юська, читай!"
- Два подкаста: "Истории про Шустрика" и "Обо всём на свете"

## Preferences
- Кофе: French press, pour-over
- Тёплая несладкая еда на завтрак
```

**ACTIVE_CONTEXT.md** — обновляется после КАЖДОГО сообщения:
```markdown
# Active Context

## Current Task
Проектирование Telegram AI-ассистента

## Last Action
Завершил design interview, зафиксировал все решения

## Next Steps
- Сгенерировать design document
- Начать реализацию Phase 1

## Open Questions
(нет)

## Session Notes
Выбрана архитектура: fork linuz90/claude-telegram-bot
```

### 4.3 Anti-Amnesia Mechanisms

**Проблема**: Claude Code сессии имеют конечный контекст, компакшн теряет детали, новые сессии начинаются с нуля.

**Решение — тройная защита**:

1. **CLAUDE.md** (в рабочей директории проекта):
   ```markdown
   # CLAUDE.md
   
   ## On Session Start
   - Read all files in vault/_system/
   - If ACTIVE_CONTEXT.md has unfinished task → resume it
   
   ## On Every Response
   - Update vault/_system/ACTIVE_CONTEXT.md with:
     - current_task, last_action, next_steps
   - If significant decision made → create decisions/ entry
   
   ## On Important Facts
   - Append to vault/_system/MEMORY.md if new persistent fact
   - Keep MEMORY.md under 2000 tokens (summarize if growing)
   ```

2. **ACTIVE_CONTEXT.md** — обновляется после каждого ответа бота. Переживает компакшн и перезапуски сессий. Стоимость = 1 write_file tool call (~0 при использовании через Pro/Max).

3. **Daily logs** — append-only бэкап в `daily/YYYY-MM-DD.md`. Если сессия крашнулась — можно восстановить контекст из лога.

### 4.4 Write Strategy

**Автоматически** (бот сам):
- ACTIVE_CONTEXT.md — после каждого ответа
- Daily log — append значимых действий
- Project log — при работе над проектом

**Явно** (по команде пользователя):
- "Запомни что..." → MEMORY.md или соответствующий area/project файл
- "Создай решение о..." → decisions/

**Вручную** (пользователь в Obsidian GUI):
- Любые правки vault — бот увидит при следующем чтении

---

## 5. Scheduling

### 5.1 Generic Task Engine

Никаких хардкоженных "утренних брифингов". Пользователь описывает задачу естественным языком, бот парсит и создаёт запись:

```typescript
interface ScheduledTask {
  id: string;
  what: string;                    // "Проверь Gmail, пришёл ли ответ от Amazon"
  schedule: string;                // cron expression or interval
  until?: string;                  // condition for auto-remove (CONDITION_MET)
  urgency: 'low' | 'medium' | 'high' | 'critical';
  deliverTo: string;               // "topic:job-search" | "dm"
  quietHours?: {                   // per-task, optional
    start: string;                 // "23:00"
    end: string;                   // "08:00"
    action: 'skip' | 'queue';     // skip or accumulate
  };
  createdAt: string;
  lastRunAt?: string;
  status: 'active' | 'paused' | 'completed';
}
```

### 5.2 Task Lifecycle

```
User: "Каждые 2 часа проверяй Gmail на ответ от Amazon рекрутера.
       Urgency high. Когда ответ получен — останови."

Bot parses → creates task:
  schedule: "0 */2 * * *"
  until: "ответ от Amazon рекрутера получен"
  urgency: "high"
  deliverTo: "topic:job-search"

Runner loop:
  1. croner fires at schedule
  2. Spawn Claude Code session with task context
  3. Claude Code executes (checks Gmail via MCP)
  4. If condition met → mark completed, notify user
  5. If not → report status with inline buttons [OK | Snooze 1h | Stop]
  6. If urgency=high + no response → re-notify based on urgency rules
```

### 5.3 Persistence

Tasks stored in `vault/tasks.json` (JSON, not SQLite — simpler, vault-compatible, Obsidian-viewable).

### 5.4 Urgency Levels

| Level | Behaviour |
|---|---|
| `low` | Deliver once, no follow-up |
| `medium` | Deliver + 1 reminder after 1h if no response |
| `high` | Deliver + remind every 30min until acknowledged |
| `critical` | Ignore quiet hours, deliver immediately, remind every 15min |

### 5.5 Inline Buttons for Decisions

Когда scheduled task требует решения пользователя:

```
📬 Gmail Check (job-search)
Получен ответ от Amazon рекрутера:
"We'd like to schedule a technical interview..."

[✅ Reply Now] [⏰ Snooze 1h] [⏭ Skip] [🛑 Stop Task]
```

Реализация через grammY `InlineKeyboard` + callback handlers.

---

## 6. Message Handling

### 6.1 Debounce

Telegram users часто отправляют мысль несколькими сообщениями подряд. Без debounce бот обработает каждое отдельно.

```typescript
// Per-user debounce with 2-second window
const pendingMessages = new Map<string, {
  messages: string[];
  timer: NodeJS.Timeout;
}>();

function handleMessage(ctx: Context, text: string) {
  const key = getSessionKey(ctx);
  const pending = pendingMessages.get(key);
  
  if (pending) {
    clearTimeout(pending.timer);
    pending.messages.push(text);
  } else {
    pendingMessages.set(key, { messages: [text], timer: null! });
  }
  
  const entry = pendingMessages.get(key)!;
  entry.timer = setTimeout(() => {
    const combined = entry.messages.join('\n');
    pendingMessages.delete(key);
    processWithClaude(ctx, combined);
  }, 2000);
}
```

**`+` prefix**: Если сообщение начинается с `+` — явное дополнение к предыдущему, конкатенируется даже если таймер уже сработал (в пределах 30 секунд).

### 6.2 Voice Pipeline

```
User voice (OGG) → Parakeet v3 (local) → text → Claude Code → text response
```

- NVIDIA Parakeet TDT 0.6B v3: локальный, 600M параметров, 25 языков (вкл. русский)
- Быстрее Whisper Large v3 на CPU, OpenAI-совместимый API
- Запуск: `docker compose up parakeet-cpu -d` (порт 5092)
- Ответ всегда текстом (TTS не нужен)
- Транскрипция показывается пользователю italic перед ответом бота

```typescript
async function handleVoice(ctx: Context) {
  const file = await ctx.getFile();
  const buffer = await downloadFile(file.file_path!);
  
  const transcript = await parakeetSTT(buffer, 'ogg');
  
  // Show transcription
  await ctx.reply(`_${transcript}_`, { parse_mode: 'Markdown' });
  
  // Process as text
  await processWithClaude(ctx, transcript);
}
```

### 6.3 Long Responses

Telegram limit = 4096 chars. Если ответ Claude длиннее:
- Разбить на части по абзацам (не по символам)
- Альтернатива: Telegraph export (как в Claudegram) для очень длинных ответов
- MVP: split by paragraphs

---

## 7. MCP Integrations

### 7.1 Already Configured in Claude Code

Эти MCP-серверы уже настроены в Claude Code и наследуются автоматически:

| MCP Server | Purpose |
|---|---|
| **Gmail** | Читать/искать/отправлять email |
| **Google Calendar** | Расписание, события, напоминания |
| **Telegram Userbot** | Действия от имени пользователя в TG (MTProto) |

### 7.2 To Add

| MCP Server | Purpose | Package |
|---|---|---|
| **Filesystem** | Scoped доступ к vault | `@modelcontextprotocol/server-filesystem` |

### 7.3 ask_user MCP Server

Из linuz90/claude-telegram-bot — MCP сервер, позволяющий Claude Code запрашивать ввод пользователя через inline кнопки. Используется для:
- Уточняющих вопросов во время выполнения задачи
- Подтверждения опасных действий (удаление, отправка email)
- Выбора из вариантов

---

## 8. Deployment

### 8.1 Environment

- **Machine**: Рабочая машина (always-on)
- **Process manager**: pm2
- **Repository**: GitHub private repo

### 8.2 Required Environment Variables

```env
# Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=...          # Whitelist (single user)
TELEGRAM_FORUM_CHAT_ID=...    # Forum group ID

# Parakeet v3 (local STT)
PARAKEET_URL=http://localhost:5092/v1

# Paths
VAULT_PATH=~/vault
WORKSPACE_PATH=~/workspace

# Claude Code
# No API key needed — uses Pro/Max subscription via CLI auth
```

### 8.3 pm2 Config

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'kuzma',
    script: 'dist/index.js',
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

### 8.4 Health & Monitoring

- pm2 built-in monitoring (`pm2 monit`)
- Bot sends startup message to DM: "🟢 Кузьма на связи"
- Crash recovery: pm2 autorestart + ACTIVE_CONTEXT.md ensures context survival
- Optional: heartbeat message every 6h to confirm bot is alive

---

## 9. Implementation Roadmap

### Phase 1: Core Bot (Days 1-3)

- [ ] Fork linuz90/claude-telegram-bot
- [ ] Set up project structure (TypeScript, grammY)
- [ ] UserContext abstraction
- [ ] DM message handling → Claude Code SDK
- [ ] Basic vault: create `_system/` files (SOUL.md, MEMORY.md, ACTIVE_CONTEXT.md)
- [ ] CLAUDE.md with instructions to read vault + update ACTIVE_CONTEXT.md
- [ ] pm2 deployment
- [ ] Auth middleware (whitelist single user)

**Deliverable**: Bot responds in DM, reads/writes vault, survives restarts.

### Phase 2: Forum Topics (Days 4-5)

- [ ] Enable forum group handling
- [ ] Session key routing: `telegram:{chatId}:topic:{threadId}`
- [ ] Topic name ↔ threadId mapping (stored in vault)
- [ ] Typing indicator in correct thread
- [ ] Handle General Topic (threadId=1)

**Deliverable**: Messages in topic "RepBoost" → Claude Code gets RepBoost context.

### Phase 3: Voice + Debounce (Days 6-7)

- [ ] Parakeet v3 Docker setup + STT integration (OpenAI-compatible client)
- [ ] 2-second debounce timer + concatenation
- [ ] `+` prefix for explicit append
- [ ] Long message splitting (4096 char limit)
- [ ] Italic transcription display before response

**Deliverable**: Full voice workflow, clean multi-message handling.

### Phase 4: Scheduling (Days 8-11)

- [ ] `croner` integration for cron scheduling
- [ ] ScheduledTask interface + vault/tasks.json persistence
- [ ] Natural language → task parsing (Claude Code handles this)
- [ ] Task runner loop (spawn Claude Code per task execution)
- [ ] Inline buttons: approve/snooze/skip/stop
- [ ] Per-task urgency levels + reminder logic
- [ ] Per-task quiet hours (configurable via chat)
- [ ] Conditional tasks (CONDITION_MET pattern)

**Deliverable**: "Каждые 2 часа проверяй Gmail" works end-to-end.

### Phase 5: Polish (Days 12-14)

- [ ] Error handling & graceful degradation
- [ ] Startup/health notifications
- [ ] Daily log auto-generation
- [ ] Decision record creation on significant choices
- [ ] Message formatting (Markdown → Telegram MarkdownV2)
- [ ] Edge case handling (empty responses, timeouts, rate limits)
- [ ] README.md for the repo

**Deliverable**: Production-ready personal assistant.

---

## 10. Known Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Claude Code session context overflow | Silent empty replies | ACTIVE_CONTEXT.md ensures recovery; monitor session length |
| Scheduled task spawns too many sessions | Rate limits / high cost | Queue tasks, max 1 concurrent scheduled session |
| Parakeet v3 Docker crashes | Voice stops working | pm2/Docker restart policy; fallback to Groq Whisper API |
| Vault grows too large for context | Slow startup, missed context | Keep MEMORY.md ≤2000 tokens; use selective project loading |
| Forum topic ID changes | Messages go to wrong thread | Persist mapping, validate on startup |
| pm2 crash loop | Bot offline | max_restarts=10, alert on repeated crashes |

---

## 11. Research References

Проекты, изученные в ходе дизайн-интервью:

| Project | Lang | Key Insight Borrowed |
|---|---|---|
| [linuz90/claude-telegram-bot](https://github.com/linuz90/claude-telegram-bot) | TS | **Base fork** — Claude Code SDK, ask_user MCP, grammY |
| [OpenClaw](https://github.com/openclaw/openclaw) | TS | Forum topic routing pattern, scheduled task architecture |
| [Nanobot](https://github.com/HKUDS/nanobot) | Python | MEMORY.md/HISTORY.md file-based memory pattern |
| [Kai](https://github.com/dcellison/kai) | Python | CONDITION_MET scheduling, per-task urgency |
| [Project Jarvis](https://github.com/enochko/jarvis) | Python | Obsidian vault + PARA structure |
| [RichardAtCT/claude-code-telegram](https://github.com/RichardAtCT/claude-code-telegram) | Python | Forum topic implementation, SQLite sessions |
| [Claudegram](https://github.com/NachoSEO/claudegram) | TS | Groq Whisper STT, Telegraph for long messages |

---

## 12. Future Considerations

Не в MVP, но на горизонте:

- **Multi-user**: Подключить Руслану с отдельным vault
- **TTS**: Ответы голосом (OpenAI TTS или Piper local)
- **RAG**: Semantic search по vault (LlamaIndex + FAISS) когда vault вырастет
- **Web UI**: Dashboard для задач и vault stats
- **Mobile**: Obsidian Mobile для редактирования vault на телефоне
- **VPS migration**: Когда стабилизируется — перенести на Hetzner с git sync для vault
