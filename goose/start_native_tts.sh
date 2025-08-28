#!/bin/bash
# Прямий запуск Ukrainian TTS MCP сервера

cd "$(dirname "$0")"

# Активуємо Hermit 
source bin/activate-hermit

# Встановлюємо PYTHONPATH для PyO3
export PYTHONPATH="/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian/tts_venv/lib/python3.11/site-packages:/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian:/Users/dev/Documents/GitHub/ATLAS/goose/crates/mcp-tts-ukrainian"

# Запускаємо прямо binary TTS сервера
./target/release/mcp-tts-ukrainian
