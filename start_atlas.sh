#!/bin/bash

# ATLAS System Startup Script
# Скрипт запуску повної системи ATLAS
# Включає: Goose AI Agent, Frontend Interface, Ukrainian TTS

echo "🚀 Запуск повної системи ATLAS..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 AI Agent + 🌐 Frontend + 🗣️ Ukrainian TTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Переход в директорию goose
cd /Users/dev/Documents/GitHub/ATLAS/goose

# Активация среды Hermit
echo "⚙️  Активация среды разработки Hermit..."
source bin/activate-hermit

# Проверка сборки goose
if [ ! -f "target/release/goosed" ]; then
    echo "🔨 Сборка AI Agent сервера..."
    cargo build --release -p goose-server
    if [ $? -ne 0 ]; then
        echo "❌ Ошибка сборки AI Agent сервера"
        exit 1
    fi
fi

echo "✅ AI Agent сервер готов"

# Запуск goosed в фоне
echo "🤖 Запуск AI Agent сервера (port 3000)..."
./target/release/goosed agent > /tmp/goose.log 2>&1 &
GOOSE_PID=$!
echo "   PID: $GOOSE_PID"

# Ожидание инициализации goose
sleep 3

# Переход в mcp_tts_ukrainian для запуска TTS
cd /Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian

# Проверка виртуального окружения TTS
if [ ! -d "tts_venv" ]; then
    echo "❌ TTS виртуальное окружение не найдено"
    echo "   Запустите: python3 -m venv tts_venv && source tts_venv/bin/activate && pip install git+https://github.com/robinhad/ukrainian-tts.git"
    kill $GOOSE_PID
    exit 1
fi

echo "🗣️  Запуск Ukrainian TTS сервера..."
source tts_venv/bin/activate
python3 mcp_tts_server.py > /tmp/tts.log 2>&1 &
TTS_PID=$!
echo "   PID: $TTS_PID"

# Ожидание инициализации TTS
sleep 5

# Переход в frontend
cd /Users/dev/Documents/GitHub/ATLAS/frontend

# Проверка виртуального окружения frontend
if [ ! -d "venv" ]; then
    echo "❌ Frontend виртуальное окружение не найдено"
    echo "   Запустите: python3 -m venv venv && source venv/bin/activate && pip install requests"
    kill $GOOSE_PID $TTS_PID
    exit 1
fi

# Запуск frontend с виртуальным окружением
echo "🌐 Запуск веб-интерфейса (port 8080)..."
source venv/bin/activate
python3 atlas_minimal_live.py > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "   PID: $FRONTEND_PID"

# Ожидание инициализации frontend
sleep 3

echo ""
echo "🎉 СИСТЕМА ATLAS ПОЛНОСТЬЮ ЗАПУЩЕНА!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 AI Agent Server:     http://localhost:3000   (PID: $GOOSE_PID)"
echo "🌐 Web Interface:       http://localhost:8080   (PID: $FRONTEND_PID)"  
echo "🗣️  Ukrainian TTS:       MCP Server Active      (PID: $TTS_PID)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 УПРАВЛЕНИЕ СИСТЕМОЙ:"
echo "   ⏹️  Остановка:  kill $GOOSE_PID $FRONTEND_PID $TTS_PID"
echo "   📊 Мониторинг: curl http://localhost:3000/health"
echo "   🌐 Интерфейс:  открыть http://localhost:8080"
echo ""
echo "📄 ЛОГИ СИСТЕМЫ:"
echo "   🤖 AI Agent:    tail -f /tmp/goose.log"
echo "   🌐 Frontend:    tail -f /tmp/frontend.log"
echo "   🗣️  TTS Server:  tail -f /tmp/tts.log"
echo ""
echo "💡 Система готова к работе! Откройте http://localhost:8080"

# Функция очистки при выходе
cleanup() {
    echo ""
    echo "🛑 Остановка системы ATLAS..."
    kill $GOOSE_PID $FRONTEND_PID $TTS_PID 2>/dev/null
    echo "✅ Все компоненты остановлены"
    exit 0
}

# Перехват сигналов для корректного завершения
trap cleanup SIGINT SIGTERM

# Ожидание завершения процессов
wait
