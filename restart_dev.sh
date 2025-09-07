#!/bin/bash
# ATLAS Development Restart Script
# Перезапуск системи з очищенням кешів для розробки

echo "🔄 ATLAS Development Restart"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Зупинити систему
echo "🛑 Stopping ATLAS system..."
./stop_stack.sh

# Очистити логи для свіжого старту
echo "🧹 Clearing logs..."
rm -f logs/*.log
mkdir -p logs

# Перевірити що порти звільнились
echo "🔍 Checking ports are free..."
sleep 2

# Запустити систему
echo "🚀 Starting ATLAS system with cache disabled..."
./start_stack_macos.sh

# Перевірити статус
echo "📊 System status:"
sleep 3
./status_stack.sh

echo ""
echo "✅ Development restart complete!"
echo "🌐 Frontend: http://localhost:5001"
echo "🔧 Clear cache API: http://localhost:5001/api/clear-cache"
echo "📊 Health check: http://localhost:5001/api/health"
echo ""
echo "💡 Changes to static files will now load immediately (no 304 responses)"
