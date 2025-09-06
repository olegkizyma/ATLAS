#!/usr/bin/env bash
set -euo pipefail
# Stop Goose web and Ukrainian TTS started by start_tts_and_goose.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
GOOSE_PID_FILE="$LOG_DIR/goose.pid"
TTS_PID_FILE="$LOG_DIR/tts.pid"

graceful_kill() {
  local pid=$1
  local name=$2
  if [ -z "$pid" ]; then return; fi
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "[stop] $name PID $pid not running"
    return
  fi
  echo "[stop] Stopping $name (PID $pid)"
  kill -TERM "$pid" 2>/dev/null || true
  local i=0
  while kill -0 "$pid" 2>/dev/null && [ $i -lt 10 ]; do
    sleep 1; i=$((i+1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "[stop] Force killing $name (PID $pid)"
    kill -KILL "$pid" 2>/dev/null || true
  fi
  echo "[stop] $name stopped"
}

if [ -f "$GOOSE_PID_FILE" ]; then
  GOOSE_PID=$(cat "$GOOSE_PID_FILE" 2>/dev/null || true)
  if [ -n "$GOOSE_PID" ] && kill -0 "$GOOSE_PID" 2>/dev/null; then
    graceful_kill "$GOOSE_PID" "Goose"
  else
    echo "[stop] Goose pid file exists but process not running: $GOOSE_PID"
  fi
  rm -f "$GOOSE_PID_FILE"
fi

if [ -f "$TTS_PID_FILE" ]; then
  TTS_PID=$(cat "$TTS_PID_FILE" 2>/dev/null || true)
  if [ -n "$TTS_PID" ] && kill -0 "$TTS_PID" 2>/dev/null; then
    graceful_kill "$TTS_PID" "Ukrainian TTS"
  else
    echo "[stop] TTS pid file exists but process not running: $TTS_PID"
  fi
  rm -f "$TTS_PID_FILE"
fi

# Also try to kill by process name / port as fallback
echo "[stop] Ensuring ports 3000/3001 are free"
for p in 3000 3001; do
  f=$(lsof -tiTCP:$p -sTCP:LISTEN || true)
  if [ -n "$f" ]; then
    echo "[stop] Killing processes on port $p: $f"
    echo "$f" | xargs -r kill -9
  fi
done

echo "[stop] Done"
