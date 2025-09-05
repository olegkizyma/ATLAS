#!/usr/bin/env bash
set -euo pipefail

# Simple E2E smoke checks for ATLAS Pure Intelligent System
# Ports: 5001 (ATLAS Web), 3010 (AI API), 3000 (Goose), 3001 (TTS)

function check() {
  local name="$1"; shift
  local url="$1"; shift
  local required="${3:-true}"
  
  echo "[SMOKE] Checking ${name}: ${url}"
  http_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}") || http_code=000
  echo "[SMOKE] ${name} HTTP ${http_code}"
  
  if [[ "${http_code}" == "200" ]]; then
    echo "[SMOKE] ${name} OK"
  elif [[ "${required}" == "true" ]]; then
    echo "[SMOKE] ${name} FAILED (required service)"; exit 1
  else
    echo "[SMOKE] ${name} WARNING (optional service)"
  fi
}

echo "[SMOKE] ATLAS Pure Intelligent System - E2E Smoke Test"
echo "[SMOKE] =================================================="

# Required services
check "ATLAS Web Interface"  "http://localhost:5001/api/health" true
check "Local AI API"         "http://127.0.0.1:3010/v1/models" true

# Optional but recommended services
check "Goose Executor"       "http://127.0.0.1:3000/health" false
check "Ukrainian TTS"        "http://127.0.0.1:3001/health" false

echo "[SMOKE] =================================================="
echo "[SMOKE] OK: all required endpoints healthy"
echo "[SMOKE] ATLAS Pure Intelligent System smoke test passed"
