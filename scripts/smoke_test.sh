#!/usr/bin/env bash
# Simple smoke test for ATLAS frontend + orchestrator
set -euo pipefail
BASE_FRONTEND=${BASE_FRONTEND:-http://127.0.0.1:5001}
CHAT_ENDPOINT=${CHAT_ENDPOINT:-$BASE_FRONTEND/api/chat}
HEALTH_ENDPOINT=${HEALTH_ENDPOINT:-$BASE_FRONTEND/api/health}
PREP_ENDPOINT=${PREP_ENDPOINT:-$BASE_FRONTEND/api/voice/prepare_response}

log(){ echo -e "[SMOKE] $1"; }

fail(){ echo "[FAIL] $1" >&2; exit 1; }

# 1) Health
log "Checking health $HEALTH_ENDPOINT"
health_json=$(curl -s --max-time 5 "$HEALTH_ENDPOINT" || true)
[[ -z "$health_json" ]] && fail "Empty health response"

# 2) Chat
log "Posting chat"
chat_json=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"message":"Привіт, як справи?","sessionId":"smoke"}' "$CHAT_ENDPOINT" || true)
[[ -z "$chat_json" ]] && fail "Empty chat response"

echo "$chat_json" | grep -qi 'atlas' || fail "Chat response missing Atlas marker"

# 3) Voice prepare
log "Preparing voice response"
prep_json=$(curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"text":"[АТЛАС] Тест синтезу"}' "$PREP_ENDPOINT" || true)
[[ -z "$prep_json" ]] && fail "Empty prepare_response"

echo "$prep_json" | grep -qi 'atlas' || fail "prepare_response missing agent"

log "All smoke tests passed"
