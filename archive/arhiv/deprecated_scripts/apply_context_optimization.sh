#!/bin/bash
set -e

echo "🔧 Застосування оптимізацій контексту для ATLAS..."

# Зупинити систему якщо працює
echo "🛑 Зупинка ATLAS..."
./stop_stack.sh || true

# Додати нові налаштування до .env файлів
echo "📝 Оновлення конфігурації контексту..."

# Frontend new config
if [ -f "frontend_new/config/.env" ]; then
  echo "" >> frontend_new/config/.env
  echo "# Context Management - Auto-added by context optimization" >> frontend_new/config/.env
  cat context_limits.env >> frontend_new/config/.env
  echo "✅ Додано налаштування до frontend_new/config/.env"
fi

# Main config
if [ -f "config.yaml" ]; then
  echo "📄 Додання налаштувань до config.yaml..."
  cat >> config.yaml << 'EOF'

# Context Management Settings
context:
  strategy: "summarize"
  max_tokens: 45000
  auto_truncate: true
  compression_ratio: 0.7
  log_usage: true

# Goose specific limits  
goose:
  context_limit: 45000
  lead_context_limit: 45000
  worker_context_limit: 35000
  context_strategy: "summarize"
  
EOF
  echo "✅ Додано налаштування до config.yaml"
fi

# Експорт змінних середовища
echo "🌍 Експорт змінних середовища..."
set -a
source context_limits.env
set +a

# Створити резервну копію логів
echo "📋 Створення резервної копії логів..."
mkdir -p logs/context_optimization_$(date +%Y%m%d_%H%M%S)
cp -r logs/*.log logs/context_optimization_$(date +%Y%m%d_%H%M%S)/ 2>/dev/null || true

echo "✨ Оптимізації застосовано!"
echo ""
echo "📊 Нові ліміти контексту:"
echo "  • ORCH_MAX_MISTRAL_USER_CHARS: 15000 (було 28000)"
echo "  • ORCH_MAX_MISTRAL_SYSTEM_CHARS: 3000 (було 4000)" 
echo "  • GOOSE_CONTEXT_LIMIT: 45000 (було по замовчуванню)"
echo "  • GOOSE_CONTEXT_STRATEGY: summarize"
echo ""
echo "🚀 Запуск системи з новими налаштуваннями:"
echo "./start_stack.sh"
echo ""
echo "📈 Для моніторингу використання контексту дивись логи:"
echo "tail -f frontend_new/orchestrator/server.log | grep CONTEXT"
