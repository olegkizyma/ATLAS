#!/bin/bash

# ATLAS System Startup Script (Fast Start)
# Скрипт швидкого запуску системи ATLAS (без компіляції)
# Включає: Goose AI Agent, Frontend Interface

# Функція зупинки попередніх процесів
stop_processes() {
    echo "🛑 Зупиняємо попередні процеси..."
    pkill -f goosed && echo "   ✓ Зупинено AI Agent"
    pkill -f atlas_minimal && echo "   ✓ Зупинено External Frontend"
    sleep 3
    echo "✅ Очищення завершено"
    echo ""
}

# Спочатку зупиняємо всі попередні процеси
stop_processes

echo "🚀 Швидкий запуск системи ATLAS..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 AI Agent + 🌐 External Frontend"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Переход в директорию goose
cd /Users/dev/Documents/GitHub/ATLAS/goose

# Активация среды Hermit
echo "⚙️  Активація середовища розробки Hermit..."
source bin/activate-hermit

if [ $? -ne 0 ]; then
    echo "❌ Не вдалося активувати Hermit середовище"
    exit 1
fi

## ---------------- AI Agent (goosed) run ----------------
# Режим сборки (можно переопределить: export GOOSE_BUILD_MODE=debug)
BUILD_MODE=${GOOSE_BUILD_MODE:-release}
GOOSED_PATH="target/${BUILD_MODE}/goosed"

echo "🔍 Режим: ${BUILD_MODE} (бінарний файл: ${GOOSED_PATH})"

# Проверяем наличие скомпилированного бинарного файла
if [ ! -f "${GOOSED_PATH}" ]; then
    echo "❌ Бінарний файл не знайдено: ${GOOSED_PATH}"
    echo "💡 Спочатку скомпілюйте систему: ./build_atlas.sh"
    exit 1
fi

# Проверяем что файл исполняемый
if [ ! -x "${GOOSED_PATH}" ]; then
    echo "🔧 Роблю файл виконуваним..."
    chmod +x "${GOOSED_PATH}"
fi

echo "✅ AI Agent готовий до запуску"

# Запуск goosed в фоне
echo "🤖 Запуск AI Agent сервера (port 3000)..."
echo "📋 Логи AI Agent будуть виводитись нижче..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
"./${GOOSED_PATH}" agent &
GOOSE_PID=$!
echo "   PID: $GOOSE_PID"

# Перевірка чи процес запущено
if ! kill -0 $GOOSE_PID 2>/dev/null; then
    echo "❌ Не вдалося запустити AI Agent. Перевірте логи: tail -f /tmp/goose.log"
    exit 1
fi

# Ожидание инициализации goose
echo "⏳ Очікування ініціалізації AI Agent..."
sleep 3

# Переход в frontend
cd /Users/dev/Documents/GitHub/ATLAS/frontend

# Проверка виртуального окружения frontend
if [ ! -d "venv" ]; then
    echo "⚠️ Frontend віртуальне середовище не знайдено, створюємо..."
    python3 -m venv venv
    source venv/bin/activate
    
    echo "📦 Встановлення необхідних пакетів для Frontend..."
    # Оновлюємо pip
    pip install -U pip wheel setuptools
    
    # Встановлюємо необхідні пакети
    pip install requests
    
    # Перевірка успішності встановлення
    if python3 -c "import requests" 2>/dev/null; then
        echo "✅ Frontend середовище створено та налаштовано успішно"
    else
        echo "⚠️ Деякі модулі не вдалося встановити. Можливі проблеми при роботі Frontend."
    fi
else
    # Активуємо існуюче середовище і перевіряємо наявність необхідних пакетів
    source venv/bin/activate
    
    # Перевіряємо наявність requests
    if ! python3 -c "import requests" 2>/dev/null; then
        echo "⚠️ Модуль requests не знайдено, встановлюємо..."
        pip install requests
        if python3 -c "import requests" 2>/dev/null; then
            echo "✅ Requests встановлено успішно"
        else
            echo "❌ Не вдалося встановити requests"
        fi
    fi
fi

# Запуск frontend с виртуальным окружением
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🌐 Запуск зовнішнього веб-інтерфейсу (port 8080)..."
echo "📋 Логи Frontend будуть виводитись через 10 секунд..."
# Используем полный путь к Python из виртуального окружения для надежного запуска
FRONTEND_VENV_PYTHON="$(pwd)/venv/bin/python3"
$FRONTEND_VENV_PYTHON atlas_minimal_live.py > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "   PID: $FRONTEND_PID"

# Перевірка чи процес запущено
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Не вдалося запустити External Frontend. Перевірте логи: tail -f /tmp/frontend.log"
    kill $GOOSE_PID
    exit 1
fi

# Почекаємо трохи, щоб побачити, чи не завершиться процес одразу після запуску
sleep 2
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ External Frontend завершився одразу після запуску"
    echo "📋 Останні рядки логу External Frontend:"
    tail -10 /tmp/frontend.log
    kill $GOOSE_PID
    exit 1
fi

# Ожидание инициализации frontend
echo "⏳ Очікування ініціалізації Frontend..."
sleep 1

# Перевірка доступності сервісів
echo "🔍 Перевірка доступності сервісів..."

# Функція очікування сервісу з таймаутом
wait_for_service() {
    local url=$1
    local name=$2
    local pid=$3
    local logfile=$4
    local max_attempts=${5:-30}  # 30 спроб за замовчуванням
    local attempt=1
    local success=false
    
    echo -n "   🔄 Очікування сервісу $name..."
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s $url > /dev/null 2>&1; then
            echo " ✅ доступний"
            success=true
            break
        fi
        
        # Перевіряємо, чи процес ще живий
        if ! kill -0 $pid 2>/dev/null; then
            echo " ❌ помилка запуску!"
            echo "⚠️ Процес $name (PID: $pid) завершився. Останні рядки логу:"
            tail -10 $logfile
            return 1
        fi
        
        sleep 1
        attempt=$((attempt+1))
        echo -n "."
    done
    
    if [ "$success" = "false" ]; then
        echo " ⚠️ таймаут очікування"
        echo "   Сервіс $name не відповідає, але процес запущено. Перевірте логи: $logfile"
        return 2
    fi
    
    return 0
}

# Перевірка AI Agent сервера
wait_for_service "http://localhost:3000/health" "AI Agent" "$GOOSE_PID" "/tmp/goose.log" 20 || {
    echo "❌ Не вдалося запустити AI Agent. Зупиняємо всі процеси..."
    kill $FRONTEND_PID 2>/dev/null || true
    exit 1
}

# Перевірка External Frontend
wait_for_service "http://localhost:8080" "External Frontend" "$FRONTEND_PID" "/tmp/frontend.log" 15 || {
    echo "❌ Не вдалося запустити External Frontend. Зупиняємо всі процеси..."
    kill $GOOSE_PID 2>/dev/null || true
    exit 1
}

echo ""
echo "🎉 СИСТЕМА ATLAS УСПІШНО ЗАПУЩЕНА!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 AI Agent Server:     http://localhost:3000   (PID: $GOOSE_PID)"
echo "🌐 External Web UI:     http://localhost:8080   (PID: $FRONTEND_PID)"  
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⏹️  Для зупинки: kill $GOOSE_PID $FRONTEND_PID"
echo "� Веб інтерфейс: http://localhost:8080"
echo ""

# Функция очистки при выходе
cleanup() {
    echo ""
    echo "🛑 Зупинка системи ATLAS..."
    kill $GOOSE_PID $FRONTEND_PID 2>/dev/null || true
    kill $FRONTEND_LOGS_PID $GOOSE_LOGS_PID 2>/dev/null || true
    # Додатково зупиняємо процеси за іменем (на випадок, якщо PID змінилися)
    pkill -f goosed 2>/dev/null || true
    pkill -f atlas_minimal 2>/dev/null || true
    echo "✅ Всі компоненти зупинено"
    exit 0
}

# Перехват сигналів для корректного завершения
trap cleanup SIGINT SIGTERM

# Запускаємо моніторинг логів в інтерактивному режимі
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 ІНТЕРАКТИВНИЙ РЕЖИМ - Логи системи:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Функція для виведення логів frontend через 10 секунд
show_frontend_logs() {
    sleep 10
    echo ""
    echo "🌐 FRONTEND ЛОГИ:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    tail -f /tmp/frontend.log
}

# Запускаємо показ логів frontend в фоні
show_frontend_logs &
FRONTEND_LOGS_PID=$!

# Виводимо логи AI Agent в основному потоці
echo "🤖 AI AGENT ЛОГИ:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Трохи почекаємо щоб логи з'явилися
sleep 2

# Виводимо логи AI Agent в реальному часі
tail -f /tmp/goose.log &
GOOSE_LOGS_PID=$!

# Моніторинг процесів
while true; do
    # Перевіряємо чи працюють процеси
    if ! kill -0 $GOOSE_PID 2>/dev/null; then
        echo "⚠️ AI Agent завершився!"
        kill $FRONTEND_LOGS_PID $GOOSE_LOGS_PID 2>/dev/null
        cleanup
        break
    fi
    
    if ! kill -0 $FRONTEND_PID 2>/dev/null; then
        echo "⚠️ Frontend завершився!"
        kill $FRONTEND_LOGS_PID $GOOSE_LOGS_PID 2>/dev/null
        cleanup
        break
    fi
    
    # Перевіряємо кожні 5 секунд
    sleep 5
done
