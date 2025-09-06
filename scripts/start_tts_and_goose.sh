#!/usr/bin/env bash
set -euo pipefail
# Start Goose web binary and Ukrainian TTS server (using ukrainian-tts/.venv)
# Logs and pids are written to LOG_DIR (default: $HOME/logs)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
mkdir -p "$LOG_DIR"

GOOSE_BIN="${GOOSE_BIN:-$HOME/.local/bin/goose}"
TTS_VENV_PY="${TTS_VENV_PY:-$REPO_ROOT/ukrainian-tts/.venv/bin/python}"
TTS_SCRIPT="$REPO_ROOT/ukrainian-tts/tts_server.py"

GOOSE_PORT="${GOOSE_PORT:-3000}"
TTS_PORT="${TTS_PORT:-3001}"

echo "[start] repo: $REPO_ROOT"
echo "[start] logs: $LOG_DIR"

start_goose() {
  if [ ! -x "$GOOSE_BIN" ]; then
    echo "[error] Goose binary not found or not executable: $GOOSE_BIN"
    return 1
  fi
  # If something already listens on the port, skip starting
  if lsof -tiTCP:$GOOSE_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[start] Port $GOOSE_PORT already in use; skipping Goose start"
    GOOSE_PID=$(lsof -tiTCP:$GOOSE_PORT -sTCP:LISTEN || true)
    [ -n "$GOOSE_PID" ] && echo "$GOOSE_PID" > "$LOG_DIR/goose.pid"
    return 0
  fi

  echo "[start] Starting Goose web via: $GOOSE_BIN web"
  nohup "$GOOSE_BIN" web > "$LOG_DIR/goose.log" 2>&1 &
  GOOSE_PID=$!
  echo "$GOOSE_PID" > "$LOG_DIR/goose.pid"
  echo "[start] Goose PID=$GOOSE_PID (logs: $LOG_DIR/goose.log)"
}

start_tts() {
  if [ ! -f "$TTS_SCRIPT" ]; then
    echo "[error] TTS script not found: $TTS_SCRIPT"
    return 1
  fi

  if [ -x "$TTS_VENV_PY" ]; then
    PY="$TTS_VENV_PY"
    echo "[start] Using venv python: $PY"
  else
    PY="$(command -v python3 || true)"
    if [ -z "$PY" ]; then
      echo "[error] No python3 found to run TTS"
      return 1
    fi
    echo "[start] venv python not found, falling back to: $PY"
  fi

  # If port already used, skip start
  if lsof -tiTCP:$TTS_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[start] Port $TTS_PORT already in use; skipping TTS start"
    TTS_PID=$(lsof -tiTCP:$TTS_PORT -sTCP:LISTEN || true)
    [ -n "$TTS_PID" ] && echo "$TTS_PID" > "$LOG_DIR/tts.pid"
    return 0
  fi

  echo "[start] Launching TTS server: $PY $TTS_SCRIPT --host 127.0.0.1 --port $TTS_PORT --device cpu"
  nohup "$PY" "$TTS_SCRIPT" --host 127.0.0.1 --port "$TTS_PORT" --device cpu > "$LOG_DIR/tts_server.log" 2>&1 &
  TTS_PID=$!
  echo "$TTS_PID" > "$LOG_DIR/tts.pid"
  echo "[start] TTS PID=$TTS_PID (logs: $LOG_DIR/tts_server.log)"
}

wait_for_http() {
  local url="$1"
  local timeout=${2:-30}
  local start_ts=$(date +%s)
  echo "[wait] waiting for $url (timeout ${timeout}s)"
  while true; do
    if curl -sS --fail "$url" >/dev/null 2>&1; then
      echo "[wait] $url is healthy"
      return 0
    fi
    now=$(date +%s)
    if [ $((now - start_ts)) -ge $timeout ]; then
      echo "[wait] timeout waiting for $url"
      return 1
    fi
    sleep 1
  done
}

echo "[start] Launching services..."
start_goose || echo "[warn] goose failed to start"
start_tts || echo "[warn] tts failed to start"

echo "[start] Waiting for health endpoints"
wait_for_http "http://127.0.0.1:$GOOSE_PORT/health" 30 || echo "[warn] Goose health didn't respond"
wait_for_http "http://127.0.0.1:$TTS_PORT/health" 30 || echo "[warn] TTS health didn't respond"

echo "[status] Goose PID: $(cat "$LOG_DIR/goose.pid" 2>/dev/null || echo 'n/a')"
echo "[status] TTS PID: $(cat "$LOG_DIR/tts.pid" 2>/dev/null || echo 'n/a')"

echo "[status] tailing last 5 lines of logs (Goose / TTS)"
echo "--- Goose log ---"
tail -n 5 "$LOG_DIR/goose.log" || true
echo "--- TTS log ---"
tail -n 5 "$LOG_DIR/tts_server.log" || true

echo "[done] Services started (or attempts made). Check logs in $LOG_DIR for details."

exit 0
