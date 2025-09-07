#!/usr/bin/env bash
set -euo pipefail
# Start Goose web binary and Ukrainian TTS server (using ukrainian-tts/.venv)
# Logs and pids are written to LOG_DIR (default: $HOME/logs)

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${LOG_DIR:-$REPO_ROOT/logs}"
mkdir -p "$LOG_DIR"

GOOSE_BIN="${GOOSE_BIN:-$HOME/.local/bin/goose}"
# Auto-detect local repository build if standard install not present
if [ ! -x "$GOOSE_BIN" ]; then
  REPO_RELEASE_BIN="$REPO_ROOT/goose/target/release/goose"
  REPO_DEBUG_BIN="$REPO_ROOT/goose/target/debug/goose"
  if [ -x "$REPO_RELEASE_BIN" ]; then
    echo "[detect] Using repo release goose binary: $REPO_RELEASE_BIN"
    GOOSE_BIN="$REPO_RELEASE_BIN"
  elif [ -x "$REPO_DEBUG_BIN" ]; then
    echo "[detect] Using repo debug goose binary: $REPO_DEBUG_BIN"
    GOOSE_BIN="$REPO_DEBUG_BIN"
  else
    echo "[detect] No goose binary in $GOOSE_BIN or repo targets."
  fi
fi
# Запис поточного (можливо неіснуючого) вибраного значення для подальшої діагностики
echo "$GOOSE_BIN" > "$LOG_DIR/goose.binpath.tmp" 2>/dev/null || true
TTS_VENV_PY="${TTS_VENV_PY:-$REPO_ROOT/ukrainian-tts/.venv/bin/python}"
TTS_SCRIPT="$REPO_ROOT/ukrainian-tts/tts_server.py"

GOOSE_PORT="${GOOSE_PORT:-3000}"
TTS_PORT="${TTS_PORT:-3001}"

echo "[start] repo: $REPO_ROOT"
echo "[start] logs: $LOG_DIR"

start_goose() {
  if [ ! -x "$GOOSE_BIN" ]; then
    echo "[error] Goose binary not found or not executable: $GOOSE_BIN"
    echo "[hint] Run: bash goose/download_cli.sh  (or build with cargo in goose/)"
    echo "[hint] After install: export GOOSE_BIN=\"$HOME/.local/bin/goose\" or place binary there."
    return 1
  fi
  # If something already listens on the port, skip starting
  if lsof -tiTCP:$GOOSE_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[start] Port $GOOSE_PORT already in use; skipping Goose start"
    GOOSE_PID=$(lsof -tiTCP:$GOOSE_PORT -sTCP:LISTEN || true)
    [ -n "$GOOSE_PID" ] && echo "$GOOSE_PID" > "$LOG_DIR/goose.pid"
  echo "$GOOSE_BIN" > "$LOG_DIR/goose.binpath" 2>/dev/null || true
    return 0
  fi

  echo "[start] Starting Goose web via: $GOOSE_BIN web --port $GOOSE_PORT"
  nohup "$GOOSE_BIN" web --port "$GOOSE_PORT" > "$LOG_DIR/goose.log" 2>&1 &
  GOOSE_PID=$!
  echo "$GOOSE_PID" > "$LOG_DIR/goose.pid"
  echo "[start] Goose PID=$GOOSE_PID (logs: $LOG_DIR/goose.log)"
  echo "$GOOSE_BIN" > "$LOG_DIR/goose.binpath" 2>/dev/null || true
}

start_tts() {
  if [ ! -f "$TTS_SCRIPT" ]; then
    echo "[error] TTS script not found: $TTS_SCRIPT"
    return 1
  fi

  # Ensure dedicated virtualenv for TTS (avoid global interpreter usage)
  TTS_VENV_DIR="$(dirname "$TTS_VENV_PY")/.."  # expect .../.venv/bin/python
  # Normalize path
  TTS_VENV_DIR="$(cd "$REPO_ROOT/ukrainian-tts/.venv" 2>/dev/null || true; pwd 2>/dev/null || echo "$REPO_ROOT/ukrainian-tts/.venv")"

  if [ ! -x "$TTS_VENV_PY" ] || [ "${FORCE_TTS_VENV_SETUP:-0}" = "1" ]; then
    echo "[setup] Creating / updating dedicated TTS virtualenv at $TTS_VENV_DIR"
    ( cd "$REPO_ROOT/ukrainian-tts" && \
      python3 -m venv .venv && \
      . .venv/bin/activate && \
      python -m pip install --upgrade pip wheel setuptools >/dev/null 2>&1 && \
      if [ -f requirements.txt ]; then \
        echo "[setup] Installing TTS requirements..."; \
        python -m pip install -r requirements.txt >> "$LOG_DIR/tts_setup.log" 2>&1 || echo "[warn] Some TTS dependencies failed (see tts_setup.log)"; \
      else \
        echo "[setup] requirements.txt missing, installing minimal deps"; \
        python -m pip install Flask soundfile numpy >> "$LOG_DIR/tts_setup.log" 2>&1 || true; \
      fi )
  fi

  if [ -x "$TTS_VENV_PY" ]; then
    PY="$TTS_VENV_PY"
    echo "[start] Using dedicated TTS venv python: $PY"
  else
    echo "[error] Failed to prepare TTS virtualenv (expected $TTS_VENV_PY)"
    return 1
  fi

  # If port already used, skip start
  if lsof -tiTCP:$TTS_PORT -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[start] Port $TTS_PORT already in use; skipping TTS start"
    TTS_PID=$(lsof -tiTCP:$TTS_PORT -sTCP:LISTEN || true)
    [ -n "$TTS_PID" ] && echo "$TTS_PID" > "$LOG_DIR/tts.pid"
    return 0
  fi

  local device_env=${TTS_DEVICE:-auto}
  local device_arg="--device ${device_env}"
  # Optional flags from env
  local strict_flag=""
  if [ "${TTS_STRICT_GPU:-0}" = "1" ] || [ "${TTS_STRICT_GPU:-}" = "true" ]; then
    strict_flag="--strict-gpu"
  fi
  local nowarmup_flag=""
  if [ "${TTS_NO_WARMUP:-0}" = "1" ] || [ "${TTS_NO_WARMUP:-}" = "true" ]; then
    nowarmup_flag="--no-warmup"
  fi

  echo "[start] Launching TTS server (isolated env): $PY $TTS_SCRIPT --host 127.0.0.1 --port $TTS_PORT $device_arg $strict_flag $nowarmup_flag"
  ( source "$(dirname "$TTS_VENV_PY")/activate" 2>/dev/null || true; \
    nohup "$PY" "$TTS_SCRIPT" --host 127.0.0.1 --port "$TTS_PORT" ${device_arg} ${strict_flag} ${nowarmup_flag} > "$LOG_DIR/tts_server.log" 2>&1 & echo $! > "$LOG_DIR/tts.tmp.pid" )
  if [ -f "$LOG_DIR/tts.tmp.pid" ]; then
    mv "$LOG_DIR/tts.tmp.pid" "$LOG_DIR/tts.pid" 2>/dev/null || true
    TTS_PID=$(cat "$LOG_DIR/tts.pid" 2>/dev/null || echo "")
  fi
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

echo "[start] Waiting for Goose health endpoints"
if ! wait_for_http "http://127.0.0.1:$GOOSE_PORT/health" 15; then
  echo "[info] Primary /health failed, trying /api/health"
  wait_for_http "http://127.0.0.1:$GOOSE_PORT/api/health" 15 || echo "[warn] Goose health didn't respond on /health or /api/health"
fi

echo "[start] Waiting for TTS health endpoint"
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
