#!/bin/bash

# 📊 Скрипт для показу списку всіх сесій Goose

SESSIONS_DIR="$HOME/.local/share/goose/sessions"

echo "📊 Всі сесії Goose (від найновіших):"
echo "─────────────────────────────────────────────────────"

ls -lt "$SESSIONS_DIR"/*.jsonl 2>/dev/null | head -10 | while read -r line; do
    # Витягуємо ім'я файлу
    filename=$(echo "$line" | awk '{print $NF}')
    basename_file=$(basename "$filename")
    
    # Витягуємо розмір
    size=$(echo "$line" | awk '{print $5}')
    
    # Витягуємо дату
    date_part=$(echo "$line" | awk '{print $6, $7, $8}')
    
    # Форматуємо розмір
    if [ "$size" -gt 1048576 ]; then
        size_formatted="$(($size / 1048576))MB"
    elif [ "$size" -gt 1024 ]; then
        size_formatted="$(($size / 1024))KB"
    else
        size_formatted="${size}B"
    fi
    
    echo "📁 $basename_file"
    echo "   📊 $size_formatted | ⏰ $date_part"
    echo ""
done

echo "─────────────────────────────────────────────────────"
echo "💡 Використовуйте:"
echo "   ./scripts/watch_goose_latest.sh  - для останніх записів"
echo "   ./scripts/watch_goose_live.sh    - для real-time моніторингу"
