#!/bin/bash

# Fixed Ukrainian TTS MCP Server for Goose

# Перехід до директорії
cd "$(dirname "$0")"

# Перевірка віртуального середовища
VENV_PATH="../atlas_venv"
if [ ! -d "$VENV_PATH" ]; then
    echo "Virtual environment not found at $VENV_PATH" >&2
    exit 1
fi

# Активація віртуального середовища
source "$VENV_PATH/bin/activate" 2>/dev/null || {
    echo "Failed to activate virtual environment" >&2
    exit 1
}

# Перевірка Python залежностей
python -c "import sys; sys.path.insert(0, '.'); import mcp_tts_fixed" 2>/dev/null || {
    echo "Installing missing dependencies..." >&2
    pip install -q ukrainian-tts gtts pygame mcp 2>/dev/null || {
        echo "Failed to install dependencies" >&2
        exit 1
    }
}

# Запуск виправленого сервера
exec python mcp_tts_fixed.py
