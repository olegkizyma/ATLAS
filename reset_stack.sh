#!/bin/bash

# ATLAS Reset Script
# Чистий перезапуск стеку з увімкненим реальним Ukrainian TTS

set -e

# За замовчуванням: реальний TTS і MPS на macOS (Apple Silicon). Можна перевизначити змінними середовища.
: "${REAL_TTS_MODE:=true}"
: "${TTS_DEVICE:=mps}"
# Авто-звільнення зайнятих портів під час старту та використання файлових секретів Goose
: "${FORCE_FREE_PORTS:=true}"
: "${GOOSE_DISABLE_KEYRING:=1}"

echo "🔄 Resetting ATLAS stack (REAL_TTS_MODE=${REAL_TTS_MODE}, TTS_DEVICE=${TTS_DEVICE})..."

# 1) Зупиняємо все тихо
./stop_stack.sh >/dev/null 2>&1 || true

# 2) Стартуємо macOS-стек з реальним TTS
FORCE_FREE_PORTS="${FORCE_FREE_PORTS}" \
GOOSE_DISABLE_KEYRING="${GOOSE_DISABLE_KEYRING}" \
REAL_TTS_MODE="${REAL_TTS_MODE}" \
TTS_DEVICE="${TTS_DEVICE}" \
./start_stack_macos.sh
