#!/bin/bash

# ATLAS System Auto-Recovery Script
# Скрипт для автоматичного відновлення та встановлення залежностей

echo "🔄 ATLAS Auto-Recovery Tool"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Функція для аналізу логів та виявлення проблем
analyze_log() {
    local logfile=$1
    local component=$2
    local venv_path=$3
    
    echo "🔍 Аналіз логів $component..."
    
    if [ ! -f "$logfile" ]; then
        echo "   ⚠️ Файл логу $logfile не знайдено"
        return 1
    fi
    
    # Шукаємо відсутні модулі в логах
    if grep -q "ModuleNotFoundError: No module named" "$logfile"; then
        echo "   🔎 Виявлено відсутні модулі Python:"
        
        # Витягуємо назви відсутніх модулів
        missing_modules=$(grep "ModuleNotFoundError: No module named" "$logfile" | sed -E "s/.*No module named '([^']+)'.*/\1/g")
        
        for module in $missing_modules; do
            echo "      - $module"
            
            # Якщо вказано шлях до віртуального середовища, встановлюємо модуль
            if [ -n "$venv_path" ] && [ -d "$venv_path" ]; then
                echo "      🔧 Автоматичне встановлення $module..."
                source "$venv_path/bin/activate"
                pip install "$module"
                deactivate
                echo "      ✅ Модуль $module встановлено"
            fi
        done
        
        echo "   🔄 Рекомендується перезапустити систему після встановлення модулів"
        return 0
    fi
    
    # Шукаємо проблеми з портами
    if grep -q "Address already in use" "$logfile"; then
        echo "   ⚠️ Виявлено зайняті порти:"
        grep -B 2 -A 2 "Address already in use" "$logfile"
        echo "   🔄 Рекомендується зупинити всі процеси ATLAS і спробувати знову"
        return 0
    fi
    
    echo "   ✅ Явних проблем у логах не виявлено"
    return 0
}

# Зупинка всіх процесів ATLAS
stop_atlas() {
    echo "🛑 Зупинка всіх процесів ATLAS..."
    pkill -f "goosed agent" 2>/dev/null
    pkill -f "atlas_minimal_live.py" 2>/dev/null
    pkill -f "mcp_tts_server.py" 2>/dev/null
    sleep 2
    echo "   ✅ Всі процеси зупинено"
}

# Аналіз всіх логів
echo "🔍 Перевірка логів системи..."
analyze_log "/tmp/goose.log" "AI Agent"
analyze_log "/tmp/frontend.log" "Frontend"
analyze_log "/tmp/tts.log" "TTS Server" "/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian/tts_venv"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📌 Наступні кроки:"
echo "   1. Якщо було встановлено нові модулі, запустіть: ./start_atlas.sh"
echo "   2. Для повної діагностики системи запустіть: ./diagnose.sh"
echo "   3. Для ручного перезапуску системи запустіть:"
echo "      - Зупинка: pkill -f goosed && pkill -f atlas_minimal && pkill -f mcp_tts"
echo "      - Запуск: ./start_atlas.sh"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Запитуємо користувача, чи перезапустити систему
echo -n "Бажаєте перезапустити систему ATLAS? (y/N): "
read answer

if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
    stop_atlas
    sleep 1
    echo "🚀 Запуск ATLAS..."
    ./start_atlas.sh
fi
