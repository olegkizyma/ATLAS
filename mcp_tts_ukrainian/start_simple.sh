#!/bin/bash

# Simple Ukrainian TTS MCP Server for Goose

# Перехід до директорії
cd "$(dirname "$0")"

# Перевірка віртуального середовища
VENV_PATH="../atlas_venv"
if [ ! -d "$VENV_PATH" ]; then
    echo "Virtual environment not found" >&2
    exit 1
fi

# Активація віртуального середовища
source "$VENV_PATH/bin/activate" 2>/dev/null || exit 1

# Перевірка Python залежностей (без виводу)
python -c "import sys; sys.path.insert(0, '.'); import mcp_tts_simple" 2>/dev/null || {
    # Тиха установка залежностей
    pip install -q ukrainian-tts gtts pygame mcp 2>/dev/null
}

# Запуск спрощеного сервера
exec python mcp_tts_simple.py
