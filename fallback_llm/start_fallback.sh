#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required" >&2
  exit 1
fi

cd "$DIR"
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm ci || npm i
fi

export FALLBACK_PORT=${FALLBACK_PORT:-3010}
echo "Starting fallback LLM on :$FALLBACK_PORT"
node server.js
