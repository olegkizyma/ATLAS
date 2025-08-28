#!/bin/bash

# ATLAS System Status Check Script
# Скрипт для перевірки стану компонентів системи ATLAS

echo "🔍 ATLAS System Status Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Перевірка AI Agent
AI_AGENT_PID=$(pgrep -f "goosed agent" | head -1)
if [ -n "$AI_AGENT_PID" ]; then
    echo "🤖 AI Agent: ✅ RUNNING (PID: $AI_AGENT_PID)"
    
    # Перевірка HTTP доступності
    if curl -s http://localhost:3000/health > /dev/null 2>&1; then
        echo "   🌐 API доступність: ✅ OK (http://localhost:3000)"
        
        # Отримання статусу з API
        STATUS=$(curl -s http://localhost:3000/status 2>/dev/null)
        if [ -n "$STATUS" ]; then
            echo "   📊 Статус API: $STATUS"
        fi
    else
        echo "   🌐 API доступність: ❌ ПОМИЛКА (http://localhost:3000)"
    fi
    
    # Перевірка логів
    if [ -f "/tmp/goose.log" ]; then
        echo "   📋 Останні логи:"
        tail -5 /tmp/goose.log | sed 's/^/      /'
    else
        echo "   📋 Логи недоступні: Файл /tmp/goose.log не існує"
    fi
else
    echo "🤖 AI Agent: ❌ НЕ ЗАПУЩЕНО"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Перевірка External Frontend
FRONTEND_PID=$(pgrep -f "atlas_minimal_live.py" | head -1)
if [ -n "$FRONTEND_PID" ]; then
    echo "🌐 External Frontend: ✅ RUNNING (PID: $FRONTEND_PID)"

    # Перевірка HTTP доступності
    HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8080 2>/dev/null)
    if [ "$HTTP_STATUS" = "200" ]; then
        echo "   🌐 Web доступність: ✅ OK (http://localhost:8080)"
    else
        echo "   🌐 Web доступність: ❌ ПОМИЛКА $HTTP_STATUS (http://localhost:8080)"
    fi
    
    # Перевірка логів
    if [ -f "/tmp/frontend.log" ]; then
        echo "   📋 Останні логи:"
        tail -5 /tmp/frontend.log | sed 's/^/      /'
    else
        echo "   📋 Логи недоступні: Файл /tmp/frontend.log не існує"
    fi
else
    echo "🌐 External Frontend: ❌ НЕ ЗАПУЩЕНО"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📌 Використання:"
echo "   - Перевірка логів AI Agent: tail -f /tmp/goose.log"
echo "   - Перевірка логів Frontend: tail -f /tmp/frontend.log"
echo "   - Перезапуск: ./start_atlas.sh"
echo "   - Зупинка: ./stop_atlas.sh"
echo "   - Діагностика: ./diagnose.sh"
echo "   - Автовідновлення: ./recover.sh"
echo ""
echo "🖥️ Desktop UI (опціонально):"
echo "   cd /Users/dev/Documents/GitHub/ATLAS/goose/ui/desktop && npm run start-gui"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"