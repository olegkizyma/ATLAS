#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/dev/Documents/GitHub/ATLAS"
LOG_DIR="$ROOT/logs"

echo "==> Stopping services"
for pidfile in "$LOG_DIR"/*.pid; do
  [[ -f "$pidfile" ]] || continue
  pid=$(cat "$pidfile" || echo "")
  if [[ -n "$pid" ]]; then
    echo "   - Killing PID $pid ($pidfile)"
    kill "$pid" 2>/dev/null || true
  fi
  rm -f "$pidfile"
done

echo "==> Extra cleanup"
pkill -f "atlas_server.py" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
pkill -f "/goose web" 2>/dev/null || true
pkill -f "/goosed" 2>/dev/null || true

echo "Done."
