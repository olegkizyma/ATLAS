#!/usr/bin/env bash
set -euo pipefail

# Simple E2E smoke checks for ATLAS stack
# Ports: 5001 (Flask), 5101 (Orchestrator), 3001 (TTS)

function check() {
  local name="$1"; shift
  local url="$1"; shift
  echo "[SMOKE] Checking ${name}: ${url}"
  http_code=$(curl -s -o /dev/null -w "%{http_code}" "${url}") || http_code=000
  echo "[SMOKE] ${name} HTTP ${http_code}"
  if [[ "${http_code}" != "200" ]]; then
    echo "[SMOKE] ${name} FAILED"; exit 1
  fi
}

check "Flask Health"        "http://localhost:5001/api/health"
check "Orchestrator Health"  "http://localhost:5101/health"
check "TTS Health"           "http://127.0.0.1:3001/health"

echo "[SMOKE] OK: all endpoints healthy"
