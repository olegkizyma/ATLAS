#!/bin/bash

# Ukrainian TTS MCP Server for Goose Integration

# Перехід до директорії
cd "$(dirname "$0")"

# Налаштування PYTHONPATH
export PYTHONPATH="$(pwd):$PYTHONPATH"

# Перевірка віртуального середовища
VENV_PATH="../atlas_venv"
if [ ! -d "$VENV_PATH" ]; then
    echo "❌ Virtual environment not found at $VENV_PATH" >&2
    exit 1
fi

# Активація віртуального середовища
source "$VENV_PATH/bin/activate"

# Перевірка та установка залежностей (тихо)
python -c "import ukrainian_tts, gtts, pygame, mcp" 2>/dev/null || {
    echo "📦 Installing missing dependencies..." >&2
    pip install -q ukrainian-tts torch torchaudio gtts pygame mcp requests aiofiles numpy soundfile
}

# Запуск MCP сервера для Goose
echo "🎙️ Starting Ukrainian TTS MCP Server for Goose..." >&2
exec python mcp_tts_server.py
