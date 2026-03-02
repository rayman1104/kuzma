#!/bin/bash
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
claude mcp add ask_user --scope user \
  -e BOT_BRIDGE_URL=http://localhost:3848 \
  -- bun run "$DIR/src/mcp/ask-user/server.ts"
echo "ask_user MCP registered"

claude mcp add forum --scope user \
  -e BOT_BRIDGE_URL=http://localhost:3848 \
  -- bun run "$DIR/src/mcp/forum/server.ts"
echo "forum MCP registered"
