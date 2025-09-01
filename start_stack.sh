#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/dev/Documents/GitHub/ATLAS"
LOG_DIR="$ROOT/logs"
GOOSE_DIR="$ROOT/goose"
ORCH_DIR="$ROOT/frontend_new/orchestrator"
FRONTEND_DIR="$ROOT/frontend_new"

GOOSE_BIN="$GOOSE_DIR/target/release/goose"
GOOSE_PORT=3000
ORCH_PORT=5101
FRONTEND_PORT=5001

mkdir -p "$LOG_DIR"

# Optionally load extra context limits if file exists
if [[ -f "$ROOT/context_limits.env" ]]; then
  echo "==> Loading optional context limits from context_limits.env"
  # Export only ORCH_ and GOOSE_ variables to avoid side effects
  # shellcheck disable=SC2046
  set -a
  # Read and export lines starting with ORCH_ or GOOSE_
  while IFS= read -r line; do
    case "$line" in
      ORCH_*|GOOSE_*) export "$line" || true ;;
      *) : ;;
    esac
  done < <(grep -E '^(ORCH_|GOOSE_)' "$ROOT/context_limits.env" | sed 's/[[:space:]]*#.*$//')
  set +a
fi

echo "==> Cleaning ports ($GOOSE_PORT, $ORCH_PORT, $FRONTEND_PORT)"
cleanup_port() {
  local port="$1"
  local pids
  pids=$(lsof -ti tcp:"$port" || true)
  if [[ -n "${pids}" ]]; then
    echo "   - Killing PIDs on port $port: ${pids}"
    kill -9 ${pids} 2>/dev/null || true
    sleep 0.5
  else
    echo "   - Port $port is free"
  fi
}

cleanup_port "$GOOSE_PORT"
cleanup_port "$ORCH_PORT"
cleanup_port "$FRONTEND_PORT"

echo "==> Stopping leftover processes (if any)"
pkill -f "atlas_server.py" 2>/dev/null || true
pkill -f "node server.js" 2>/dev/null || true
pkill -f "/goose web" 2>/dev/null || true
sleep 1

wait_for_port() {
  local port="$1"; local name="$2"; local retries=60
  for ((i=1;i<=retries;i++)); do
    if nc -z 127.0.0.1 "$port" 2>/dev/null; then
      echo "   - $name is up on :$port"
      return 0
    fi
    sleep 0.5
    if (( i % 10 == 0 )); then echo "   ...waiting $name (:${port}) ${i}/$retries"; fi
  done
  echo "!! $name didn't start on :$port in time" >&2
  return 1
}

echo "==> Starting Tetiana (Goose) on :$GOOSE_PORT"
if [[ ! -x "$GOOSE_BIN" ]]; then
  echo "!! Goose binary not found: $GOOSE_BIN" >&2
  exit 1
fi
(
  cd "$GOOSE_DIR"
  nohup "$GOOSE_BIN" web --port "$GOOSE_PORT" > "$LOG_DIR/goose.log" 2>&1 &
  echo $! > "$LOG_DIR/goose.pid"
)
wait_for_port "$GOOSE_PORT" "Goose"

echo "==> Starting Orchestrator (Node) on :$ORCH_PORT"
if [[ ! -f "$ORCH_DIR/server.js" ]]; then
  echo "!! Orchestrator not found: $ORCH_DIR/server.js" >&2
  exit 1
fi
(
  cd "$ORCH_DIR"
  # ensure node_modules once
  if [[ ! -d node_modules ]]; then
    echo "   - Installing orchestrator deps..."
    npm install >> "$LOG_DIR/orchestrator.log" 2>&1 || true
  fi
  nohup env ORCH_PORT="$ORCH_PORT" node server.js > "$LOG_DIR/orchestrator.log" 2>&1 &
  echo $! > "$LOG_DIR/orchestrator.pid"
)
wait_for_port "$ORCH_PORT" "Orchestrator"

echo "==> Starting Frontend on :$FRONTEND_PORT"
if [[ ! -f "$FRONTEND_DIR/start_server.sh" ]]; then
  echo "!! Frontend launcher not found: $FRONTEND_DIR/start_server.sh" >&2
  exit 1
fi
(
  cd "$FRONTEND_DIR"
  nohup ./start_server.sh > "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)
wait_for_port "$FRONTEND_PORT" "Frontend"

echo "==> All services started"
echo "   • Goose       http://127.0.0.1:$GOOSE_PORT   (log: $LOG_DIR/goose.log)"
echo "   • Orchestrator http://127.0.0.1:$ORCH_PORT   (log: $LOG_DIR/orchestrator.log)"
echo "   • Frontend    http://127.0.0.1:$FRONTEND_PORT (log: $LOG_DIR/frontend.log)"
