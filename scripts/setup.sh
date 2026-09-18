#!/usr/bin/env bash
set -euo pipefail

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it from https://bun.sh and rerun this script." >&2
  exit 1
fi

bun install
bun run check
bun test

echo
echo "Union is ready. Start it with:"
echo "  bun run start ~/Projects"
echo
echo "Then load extension/chatgpt as an unpacked Chromium extension."
