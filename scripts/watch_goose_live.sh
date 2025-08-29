#!/bin/bash

# 🔄 Скрипт для real-time моніторингу останньої сесії Goose

SESSIONS_DIR="$HOME/.local/share/goose/sessions"

echo "🔄 Real-time моніторинг останньої сесії Goose..."
echo "Натисніть Ctrl+C для виходу"
echo ""

while true; do
    # Знаходимо найновіший файл
    LATEST_SESSION=$(ls -t "$SESSIONS_DIR"/*.jsonl 2>/dev/null | head -1)
    
    if [ -n "$LATEST_SESSION" ]; then
        SESSION_NAME=$(basename "$LATEST_SESSION")
        clear
        echo "🔄 Real-time моніторинг: $SESSION_NAME"
        echo "⏰ $(date '+%H:%M:%S')"
        echo "─────────────────────────────────────────────────────"
        
        # Показуємо останні 30 рядків
        tail -30 "$LATEST_SESSION"
        
        echo "─────────────────────────────────────────────────────"
        echo "🔄 Оновлення кожні 3 секунди... (Ctrl+C для виходу)"
    else
        echo "❌ Не знайдено активних сесій"
    fi
    
    sleep 3
done
