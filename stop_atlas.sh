#!/bin/bash

# ATLAS System Stop Script
# Скрипт остановки системы ATLAS

echo "🛑 Остановка системы ATLAS..."

# Поиск процессов ATLAS
GOOSE_PID=$(pgrep -f "goosed agent")
FRONTEND_PID=$(pgrep -f "atlas_minimal_live.py")
TTS_PID=$(pgrep -f "mcp_tts_server.py")

echo "🔍 Поиск процессов ATLAS..."

if [ -n "$GOOSE_PID" ]; then
    echo "🤖 Остановка AI Agent (PID: $GOOSE_PID)..."
    kill $GOOSE_PID
fi

if [ -n "$FRONTEND_PID" ]; then
    echo "🌐 Остановка Frontend (PID: $FRONTEND_PID)..."
    kill $FRONTEND_PID
fi

if [ -n "$TTS_PID" ]; then
    echo "🗣️  Остановка TTS Server (PID: $TTS_PID)..."
    kill $TTS_PID
fi

# Ожидание завершения
sleep 2

# Принудительное завершение если нужно
REMAINING=$(pgrep -f "goosed|atlas_minimal_live|mcp_tts_server")
if [ -n "$REMAINING" ]; then
    echo "⚡ Принудительное завершение..."
    pkill -f "goosed agent"
    pkill -f "atlas_minimal_live.py"
    pkill -f "mcp_tts_server.py"
fi

echo "✅ Система ATLAS остановлена"
echo ""
echo "📄 Логи сохранены в:"
echo "   /tmp/goose.log"
echo "   /tmp/frontend.log"
echo "   /tmp/tts.log"
