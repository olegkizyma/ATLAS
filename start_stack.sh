#!/usr/bin/env bash
set -euo pipefail

ROOT="/Users/dev/Documents/GitHub/ATLAS"
LOG_DIR="$ROOT/logs"
GOOSE_DIR="$ROOT/goose"
ORCH_DIR="$ROOT/frontend_new/orchestrator"
FRONTEND_DIR="$ROOT/frontend_new"

GOOSE_BIN="$GOOSE_DIR/target/release/goose"
GOOSED_BIN="$GOOSE_DIR/target/release/goosed"
# Default ports: Goose Web (3000). For goosed, we'll auto-detect from config.toml ([server].port), fallback 3001.
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

detect_goosed_port() {
  local cfg="$GOOSE_DIR/config.toml"
  if [[ -f "$cfg" ]]; then
    awk '
      /^\s*\[server\]\s*$/ { in=1; next }
      /^\s*\[/ { in=0 }
      in && $0 ~ /^\s*port\s*=\s*[0-9]+/ {
        match($0, /[0-9]+/, m); print m[0]; exit
      }
    ' "$cfg" 2>/dev/null || true
  fi
}

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
pkill -f "/goosed" 2>/dev/null || true
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
# When SSE (/reply) is forced, prefer goosed agent server (exposes /reply).
USE_GOOSED=false
case "${ORCH_FORCE_GOOSE_REPLY:-}" in
  true|1|yes|on|TRUE|YES|ON) USE_GOOSED=true ;;
esac

if $USE_GOOSED; then
  # Prefer port from goosed config if available (may be ignored by binary)
  det_port=$(detect_goosed_port || true)
  if [[ -n "${det_port:-}" ]]; then
    echo "==> goosed config suggests port :$det_port"
  fi
  if [[ ! -x "$GOOSED_BIN" ]]; then
    echo "!! Goosed binary not found: $GOOSED_BIN" >&2
    exit 1
  fi
  echo "   - ORCH_FORCE_GOOSE_REPLY is set -> starting goosed (Agent API with /reply)"
  (
    cd "$GOOSE_DIR"
    # Ensure goosed reads local config from this repo
    : > "$LOG_DIR/goose.log"
    # Defaults can be overridden via environment (context_limits.env)
  GOOSE_PROVIDER="${GOOSE_PROVIDER:-github_copilot}" \
  GOOSE_MODEL="${GOOSE_MODEL:-gpt-4o}" \
    XDG_CONFIG_HOME="$GOOSE_DIR" \
      nohup "$GOOSED_BIN" agent >> "$LOG_DIR/goose.log" 2>&1 &
    echo $! > "$LOG_DIR/goose.pid"
  )
  # Detect actual listening port from log (e.g., "listening on 127.0.0.1:3000")
  {
    for i in $(seq 1 60); do
      if grep -Eo "listening on 127\.0\.0\.1:[0-9]+" "$LOG_DIR/goose.log" >/dev/null 2>&1; then
        break
      fi
      sleep 0.5
      (( i % 10 == 0 )) && echo "   ...waiting Goosed log (:??) ${i}/60"
    done
  } || true
  actual_port=$(grep -Eo "listening on 127\.0\.0\.1:[0-9]+" "$LOG_DIR/goose.log" | tail -n1 | sed -E 's/.*:(\d+)/\1/')
  actual_line=$(grep -Eo "listening on 127\.0\.0\.1:[0-9]+" "$LOG_DIR/goose.log" | tail -n1 || true)
  actual_port=$(printf "%s" "$actual_line" | sed -E 's/.*:([0-9]+)/\1/' || true)
  if [[ -n "${actual_port:-}" ]]; then
    GOOSE_PORT="$actual_port"
    echo "==> Goosed is listening on :$GOOSE_PORT"
  else
    # Fallback probes
    for p in 3001 3000; do
      if nc -z 127.0.0.1 "$p" 2>/dev/null; then
        GOOSE_PORT="$p"; echo "==> Fallback: detected goosed on :$GOOSE_PORT"; break
      fi
    done
  fi
  wait_for_port "$GOOSE_PORT" "Goosed"
  # Extra readiness: probe /reply endpoint once to avoid 404 races
  for i in $(seq 1 10); do
    code=$(curl -s -o /dev/null -w "%{http_code}" -H 'Accept: text/event-stream' -H 'Content-Type: application/json' -H 'X-Secret-Key: test' \
      -X POST "http://127.0.0.1:${GOOSE_PORT}/reply" --data '{"messages":[{"role":"user","created":0,"content":[{"type":"text","text":"ping"}]}],"session_id":"probe","session_working_dir":"/tmp"}') || code=000
    if [[ "$code" == "200" ]]; then break; fi
    sleep 0.5
  done
else
  if [[ ! -x "$GOOSE_BIN" ]]; then
    echo "!! Goose binary not found: $GOOSE_BIN" >&2
    exit 1
  fi
  echo "   - Starting goose web (WS UI)"
  (
    cd "$GOOSE_DIR"
    nohup "$GOOSE_BIN" web --port "$GOOSE_PORT" > "$LOG_DIR/goose.log" 2>&1 &
    echo $! > "$LOG_DIR/goose.pid"
  )
  wait_for_port "$GOOSE_PORT" "Goose Web"
fi

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
  # Always pass the resolved Goose base URL so orchestrator hits the right endpoint/port
  nohup env ORCH_PORT="$ORCH_PORT" GOOSE_BASE_URL="http://127.0.0.1:$GOOSE_PORT" node server.js > "$LOG_DIR/orchestrator.log" 2>&1 &
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
