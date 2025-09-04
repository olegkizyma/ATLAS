#!/bin/bash

# ATLAS Stack Restart Script
# Перезагрузка повного стеку ATLAS - зупинка всіх сервісів та їх повторний запуск

set -e

echo "🔄 ATLAS Stack Restart Script"
echo "🛑 Stopping all services..."
echo "========================================"

# Зупинка всіх сервісів
if [ -f "./stop_stack.sh" ]; then
    ./stop_stack.sh
else
    echo "⚠️  stop_stack.sh not found, attempting manual shutdown..."

    # Ручна зупинка основних процесів
    echo "Stopping orchestrator..."
    pkill -f "node.*server.js" || true

    echo "Stopping Python frontend..."
    pkill -f "python.*atlas_server.py" || true

    echo "Stopping recovery bridge..."
    pkill -f "python.*recovery_bridge" || true

    echo "Stopping Goose..."
    pkill -f "goose web" || true

    echo "Stopping TTS server..."
    pkill -f "python.*tts_server" || true

    # Очищення PID файлів
    rm -f logs/*.pid

    echo "✅ Manual shutdown completed"
fi

echo ""
echo "⏳ Waiting 5 seconds for complete shutdown..."
sleep 5

echo ""
echo "🚀 Starting all services..."
echo "========================================"

# Запуск всіх сервісів
if [ -f "./start_stack_macos.sh" ]; then
    ./start_stack_macos.sh
else
    echo "❌ start_stack_macos.sh not found!"
    echo "Please ensure the startup script exists and is executable."
    exit 1
fi

echo ""
echo "✅ ATLAS Stack Restart Complete!"
echo "🌐 Access interfaces:"
echo "   • Python Frontend: http://localhost:5001"
echo "   • Node.js Orchestrator: http://localhost:5101"
echo "   • Recovery Bridge: ws://localhost:5102"
echo "   • Goose Web Interface: http://localhost:3000"
echo ""
echo "📊 Check status with: ./status_stack.sh"
