#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
claude mcp add ask_user --scope user \
  -e BOT_BRIDGE_URL=http://localhost:3847 \
  -- bun run "$DIR/src/mcp/ask-user/server.ts"
echo "ask_user MCP registered"
