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
