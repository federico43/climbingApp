#!/bin/bash
set -euo pipefail

# Only install dependencies in Claude Code cloud sessions
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
npm ci --no-audit --no-fund
