#!/bin/bash

echo "🔍 ATLAS Context Diagnostics Tool"
echo "=================================="
echo ""

# Функція для підрахунку приблизної кількості токенів
estimate_tokens() {
    local text="$1"
    local char_count=${#text}
    echo $((char_count / 4))
}

# Перевірка логів на помилки token limit
echo "📊 Аналіз помилок token limit в логах:"
echo "-------------------------------------"

LOG_FILES=(
    "frontend_new/orchestrator/server.log"
    "goose/goosed.log" 
    "goose/goosed_agent.log"
    "atlas_start.log"
    "frontend/atlas_frontend.log"
)

TOKEN_ERRORS=0
for log_file in "${LOG_FILES[@]}"; do
    if [ -f "$log_file" ]; then
        errors=$(grep -i "token.*exceed\|prompt.*token.*count\|context.*limit\|model_max_prompt_tokens" "$log_file" 2>/dev/null | wc -l)
        if [ $errors -gt 0 ]; then
            echo "❌ $log_file: $errors token limit errors"
            TOKEN_ERRORS=$((TOKEN_ERRORS + errors))
            # Показати останню помилку
            echo "   Остання помилка:"
            grep -i "token.*exceed\|prompt.*token.*count\|context.*limit\|model_max_prompt_tokens" "$log_file" 2>/dev/null | tail -1 | sed 's/^/   /'
        else
            echo "✅ $log_file: Помилок token limit не знайдено"
        fi
    else
        echo "⚠️  $log_file: Файл не знайдено"
    fi
done

echo ""
echo "📈 Загальна статистика:"
echo "  • Всього помилок token limit: $TOKEN_ERRORS"

# Перевірка поточних налаштувань
echo ""
echo "⚙️  Поточні налаштування контексту:"
echo "-----------------------------------"

# Env variables
ENV_VARS=(
    "ORCH_MAX_MISTRAL_USER_CHARS"
    "ORCH_MAX_MISTRAL_SYSTEM_CHARS" 
    "ORCH_MAX_TASKSPEC_SUMMARY_CHARS"
    "GOOSE_CONTEXT_LIMIT"
    "GOOSE_CONTEXT_STRATEGY"
)

for var in "${ENV_VARS[@]}"; do
    value=$(printenv "$var" 2>/dev/null || echo "не встановлено")
    echo "  • $var: $value"
done

# Перевірка розміру конфігураційних файлів
echo ""
echo "📁 Розміри конфігураційних файлів:"
echo "----------------------------------"

CONFIG_FILES=(
    "config.yaml"
    "config2.yaml"
    "goose_ui_config.json"
    "frontend_new/config/.env"
    "frontend_new/orchestrator/intelligeich.json"
)

for config_file in "${CONFIG_FILES[@]}"; do
    if [ -f "$config_file" ]; then
        size=$(wc -c < "$config_file")
        tokens=$(estimate_tokens "$(cat "$config_file")")
        echo "  • $config_file: ${size} символів (~${tokens} токенів)"
    fi
done

# Аналіз процесів
echo ""
echo "🔄 Статус системи:"
echo "------------------"

if pgrep -f "goose" > /dev/null; then
    echo "✅ Goose процеси запущені"
    echo "  Процеси: $(pgrep -f 'goose' | wc -l)"
else
    echo "❌ Goose процеси не запущені"
fi

if pgrep -f "atlas" > /dev/null; then
    echo "✅ Atlas процеси запущені"
else
    echo "❌ Atlas процеси не запущені"  
fi

# Рекомендації
echo ""
echo "💡 Рекомендації:"
echo "----------------"

if [ $TOKEN_ERRORS -gt 0 ]; then
    echo "🔧 Виявлено помилки token limit. Рекомендується:"
    echo "   1. Застосувати оптимізації: ./apply_context_optimization.sh"
    echo "   2. Перезапустити систему: ./stop_stack.sh && ./start_stack.sh"
    echo "   3. Моніторити логи: tail -f frontend_new/orchestrator/server.log"
else
    echo "✅ Помилок token limit не виявлено"
fi

echo ""
echo "🏃‍♂️ Для застосування оптимізацій виконайте:"
echo "   ./apply_context_optimization.sh"
