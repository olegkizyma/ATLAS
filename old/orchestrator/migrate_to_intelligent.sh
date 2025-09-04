#!/bin/bash
# ATLAS Configuration Migration Script
# Поступовий перехід від хардкорів до інтелектуальної системи

echo "🚀 Starting ATLAS configuration migration..."

# Функція для резервного копіювання
backup_config() {
    local file="$1"
    if [ -f "$file" ]; then
        cp "$file" "${file}.backup.$(date +%s)"
        echo "✅ Backed up $file"
    fi
}

# Створюємо резервні копії
echo "📋 Creating backups..."
backup_config ".env"
backup_config "server.js"
backup_config "intelligeich.json"

# Генеруємо інтелектуальну конфігурацію
echo "🧠 Generating intelligent configuration..."
cd "$(dirname "$0")"
python3 ../config/configuration_migrator.py

# Перевіряємо чи все готове
if [ -f ".env.intelligent" ]; then
    echo "✅ Intelligent configuration generated"
    
    # Пропонуємо тест
    echo "🧪 Testing intelligent configuration..."
    
    # Запускаємо тестовий сервер
    if node intelligent_server.js &
    then
        SERVER_PID=$!
        sleep 5
        
        # Тестуємо health endpoint
        if curl -s http://localhost:5101/health > /dev/null; then
            echo "✅ Intelligent server test passed"
            kill $SERVER_PID
        else
            echo "❌ Intelligent server test failed"
            kill $SERVER_PID
            exit 1
        fi
    fi
    
    echo "🎉 Migration completed successfully!"
    echo "💡 To use intelligent mode:"
    echo "   1. Use 'node intelligent_server.js' instead of 'node server.js'"
    echo "   2. Set ORCH_INTELLIGENT_MODE=true in .env"
    echo "   3. Monitor system adaptation in logs"
    
else
    echo "❌ Migration failed - intelligent config not generated"
    exit 1
fi

echo "🔍 Next steps:"
echo "   • Review .env.intelligent for auto-generated settings"  
echo "   • Test the intelligent server wrapper"
echo "   • Monitor adaptive behavior in logs"
echo "   • Gradually remove hardcoded values from your code"
