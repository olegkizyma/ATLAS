#!/bin/bash

# ATLAS Diagnostic Tool
# Скрипт для збору діагностичної інформації у випадку помилки запуску

echo "🔍 ATLAS Diagnostic Information"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📅 Дата збору: $(date)"
echo "💻 Операційна система: $(uname -a)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Функція для перевірки компонента
check_component() {
    local name=$1
    local command=$2
    local version_command=$3
    
    echo "🔹 Перевірка $name:"
    
    # Перевірка наявності
    if command -v $command > /dev/null 2>&1; then
        echo "   ✅ $name знайдено: $(command -v $command)"
        
        # Виконання команди версії, якщо надана
        if [ -n "$version_command" ]; then
            echo "   📊 Версія: $($version_command 2>&1 | head -1)"
        fi
    else
        echo "   ❌ $name не знайдено в системі"
    fi
}

# Перевірка базових компонентів
check_component "Python" "python3" "python3 --version"
check_component "Pip" "pip3" "pip3 --version"
check_component "Rust" "rustc" "rustc --version"
check_component "Cargo" "cargo" "cargo --version"
check_component "Curl" "curl" "curl --version"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Перевірка доступності портів
echo "🔹 Перевірка зайнятих портів:"
for port in 3000 8080; do
    process=$(lsof -i :$port -P -n 2>/dev/null)
    if [ -n "$process" ]; then
        echo "   ⚠️ Порт $port зайнятий:"
        echo "$process" | sed 's/^/      /'
    else
        echo "   ✅ Порт $port вільний"
    fi
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Перевірка наявності віртуальних середовищ
echo "🔹 Перевірка віртуальних середовищ Python:"

check_venv() {
    local name=$1
    local path=$2
    local required_modules=$3  # Список необхідних модулів через пробіл
    
    if [ -d "$path" ]; then
        echo "   ✅ $name існує: $path"
        
        # Активація середовища та перевірка пакетів
        if [ -f "$path/bin/activate" ]; then
            source "$path/bin/activate" 2>/dev/null
            
            # Перевірка необхідних модулів
            if [ -n "$required_modules" ]; then
                echo "      � Перевірка обов'язкових модулів:"
                for module in $required_modules; do
                    if python3 -c "import $module" 2>/dev/null; then
                        echo "        ✅ $module встановлено"
                    else
                        echo "        ❌ $module відсутній!"
                    fi
                done
            fi
            
            echo "      📦 Всі встановлені пакети:"
            pip freeze | sort | sed 's/^/        /'
            deactivate 2>/dev/null
        else
            echo "      ⚠️ Середовище пошкоджене (відсутній activate скрипт)"
        fi
    else
        echo "   ❌ $name не знайдено: $path"
    fi
}

check_venv "Frontend venv" "/Users/dev/Documents/GitHub/ATLAS/frontend/venv" "requests"
check_venv "TTS venv" "/Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian/tts_venv" "pygame gtts"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Перевірка logfiles
echo "🔹 Перевірка лог-файлів:"

check_logfile() {
    local name=$1
    local path=$2
    
    if [ -f "$path" ]; then
        echo "   ✅ $name існує: $path"
        echo "      📋 Останні 5 рядків:"
        tail -5 "$path" 2>/dev/null | sed 's/^/        /'
    else
        echo "   ⚠️ $name не знайдено: $path"
    fi
}

check_logfile "AI Agent Log" "/tmp/goose.log"
check_logfile "Frontend Log" "/tmp/frontend.log"
check_logfile "TTS Log" "/tmp/tts.log"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔹 Активні процеси ATLAS:"
ps aux | grep -E "(goosed|atlas_minimal|mcp_tts)" | grep -v grep | sed 's/^/   /' || echo "   Немає активних процесів ATLAS"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📌 Рекомендації для вирішення проблем:"
echo "   1. Перевірте, чи всі порти вільні: 3000 та 8080"
echo "   2. Перевірте помилки у лог-файлах: /tmp/goose.log, /tmp/frontend.log, /tmp/tts.log"
echo "   3. Перевірте, чи встановлені всі необхідні залежності: pygame, requests, gtts"
echo "   4. Встановіть відсутні залежності для TTS сервера:"
echo "      - cd /Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian"
echo "      - source tts_venv/bin/activate"
echo "      - pip install gtts pygame"
echo "   5. Перезапустіть систему з чистими логами: ./start_atlas.sh"
echo "   6. При проблемах з віртуальними середовищами спробуйте видалити їх і дозволити скрипту створити нові:"
echo "      - rm -rf /Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian/tts_venv"
echo "      - rm -rf /Users/dev/Documents/GitHub/ATLAS/frontend/venv"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
