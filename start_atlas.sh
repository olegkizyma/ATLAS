#!/bin/bash

# ATLAS System Startup Script
# Скрипт запуску повної системи ATLAS
# Включає: Goose AI Agent, Frontend Interface, Ukrainian TTS

# Функція зупинки попередніх процесів
stop_processes() {
    echo "🛑 Зупиняємо попередні процеси..."
    pkill -f goosed && echo "   ✓ Зупинено AI Agent"
    pkill -f atlas_minimal && echo "   ✓ Зупинено Frontend"
    pkill -f mcp_tts && echo "   ✓ Зупинено TTS"
    sleep 3
    echo "✅ Очищення завершено"
    echo ""
}

# Спочатку зупиняємо всі попередні процеси
stop_processes

echo "🚀 Запуск повної системи ATLAS..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 AI Agent + 🌐 Frontend + 🗣️ Ukrainian TTS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Переход в директорию goose
cd /Users/dev/Documents/GitHub/ATLAS/goose

# Активация среды Hermit
echo "⚙️  Активация среды разработки Hermit..."
source bin/activate-hermit

# Проверка сборки goose
if [ ! -f "target/release/goosed" ]; then
    echo "🔨 Сборка AI Agent сервера..."
    cargo build --release -p goose-server
    if [ $? -ne 0 ]; then
        echo "❌ Ошибка сборки AI Agent сервера"
        exit 1
    fi
fi

echo "✅ AI Agent сервер готов"

# Запуск goosed в фоне
echo "🤖 Запуск AI Agent сервера (port 3000)..."
# Сохраняем все переменные окружения в файл для запуска процесса
env > /tmp/goose_env.txt
./target/release/goosed agent > /tmp/goose.log 2>&1 &
GOOSE_PID=$!
echo "   PID: $GOOSE_PID"

# Перевірка чи процес запущено
if ! kill -0 $GOOSE_PID 2>/dev/null; then
    echo "❌ Не вдалося запустити AI Agent. Перевірте логи: tail -f /tmp/goose.log"
    exit 1
fi

# Ожидание инициализации goose
sleep 3

# Переход в mcp_tts_ukrainian для запуска TTS
cd /Users/dev/Documents/GitHub/ATLAS/mcp_tts_ukrainian

# Проверка виртуального окружения TTS
if [ ! -d "tts_venv" ]; then
    echo "⚠️ TTS віртуальне середовище не знайдено, створюємо..."
    python3 -m venv tts_venv
    source tts_venv/bin/activate
    
    echo "📦 Встановлення необхідних пакетів для TTS..."
    # Встановлюємо базові пакети спочатку
    pip install -U pip wheel setuptools
    
    # Встановлюємо gtts та pygame
    echo "   🔄 Встановлення pygame та gtts..."
    pip install pygame gtts
    
    # Встановлюємо ukrainian-tts
    echo "   🔄 Встановлення ukrainian-tts..."
    pip install git+https://github.com/robinhad/ukrainian-tts.git
    
    # Перевірка успішності встановлення
    if python3 -c "import pygame; import gtts; import ukrainian_tts" 2>/dev/null; then
        echo "✅ TTS середовище створено та налаштовано успішно"
    else
        echo "⚠️ Деякі модулі не вдалося встановити. Можливі проблеми при роботі TTS."
    fi
else
    # Активуємо існуюче середовище і перевіряємо наявність необхідних пакетів
    source tts_venv/bin/activate
    
    # Перевіряємо наявність pygame
    if ! python3 -c "import pygame" 2>/dev/null; then
        echo "⚠️ Модуль pygame не знайдено, встановлюємо..."
        pip install pygame
        if python3 -c "import pygame" 2>/dev/null; then
            echo "✅ Pygame встановлено успішно"
        else
            echo "❌ Не вдалося встановити pygame"
        fi
    fi
    
    # Перевіряємо наявність gtts
    if ! python3 -c "import gtts" 2>/dev/null; then
        echo "⚠️ Модуль gtts не знайдено, встановлюємо..."
        pip install gtts
        if python3 -c "import gtts" 2>/dev/null; then
            echo "✅ gTTS встановлено успішно"
        else
            echo "❌ Не вдалося встановити gtts"
        fi
    fi
    
    # Перевіряємо наявність ukrainian_tts
    if ! python3 -c "import ukrainian_tts" 2>/dev/null; then
        echo "⚠️ Модуль ukrainian_tts не знайдено, встановлюємо..."
        pip install git+https://github.com/robinhad/ukrainian-tts.git
        if python3 -c "import ukrainian_tts" 2>/dev/null; then
            echo "✅ Ukrainian TTS встановлено успішно"
        else
            echo "❌ Не вдалося встановити ukrainian_tts"
        fi
    fi
fi

echo "🗣️  Запуск Ukrainian TTS сервера..."
# Проверка моделей TTS перед запуском сервера
echo "   🔍 Проверка моделей TTS..."
TTS_VENV_PYTHON="$(pwd)/tts_venv/bin/python3"
$TTS_VENV_PYTHON check_tts_models.py > /tmp/tts_check.log 2>&1
TTS_CHECK_RESULT=$?

if [ $TTS_CHECK_RESULT -ne 0 ]; then
    echo "   ⚠️ Обнаружены проблемы с моделями TTS. Подробности в логе: /tmp/tts_check.log"
    echo "   🔄 Продолжаем запуск, будет использован fallback на Google TTS"
else
    echo "   ✅ Модели TTS проверены успешно"
fi

# Используем полный путь к Python из виртуального окружения для надежного запуска
$TTS_VENV_PYTHON mcp_tts_server.py > /tmp/tts.log 2>&1 &
TTS_PID=$!
echo "   PID: $TTS_PID"

# Перевірка чи процес запущено
if ! kill -0 $TTS_PID 2>/dev/null; then
    echo "❌ Не вдалося запустити TTS сервер. Перевірте логи: tail -f /tmp/tts.log"
    kill $GOOSE_PID
    exit 1
fi

# Почекаємо трохи, щоб побачити, чи не завершиться процес одразу після запуску
sleep 2
if ! kill -0 $TTS_PID 2>/dev/null; then
    echo "❌ TTS сервер завершився одразу після запуску"
    echo "📋 Останні рядки логу TTS сервера:"
    tail -10 /tmp/tts.log
    kill $GOOSE_PID
    exit 1
fi

# Ожидание инициализации TTS
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
echo "🌐 Запуск веб-интерфейса (port 8080)..."
# Используем полный путь к Python из виртуального окружения для надежного запуска
FRONTEND_VENV_PYTHON="$(pwd)/venv/bin/python3"
$FRONTEND_VENV_PYTHON atlas_minimal_live.py > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "   PID: $FRONTEND_PID"

# Перевірка чи процес запущено
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Не вдалося запустити Frontend. Перевірте логи: tail -f /tmp/frontend.log"
    kill $GOOSE_PID $TTS_PID
    exit 1
fi

# Почекаємо трохи, щоб побачити, чи не завершиться процес одразу після запуску
sleep 2
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo "❌ Frontend завершився одразу після запуску"
    echo "📋 Останні рядки логу Frontend:"
    tail -10 /tmp/frontend.log
    kill $GOOSE_PID $TTS_PID
    exit 1
fi

# Ожидание инициализации frontend
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
    kill $TTS_PID $FRONTEND_PID 2>/dev/null || true
    exit 1
}

# Перевірка Frontend
wait_for_service "http://localhost:8080" "Frontend" "$FRONTEND_PID" "/tmp/frontend.log" 15 || {
    echo "❌ Не вдалося запустити Frontend. Зупиняємо всі процеси..."
    kill $GOOSE_PID $TTS_PID 2>/dev/null || true
    exit 1
}

echo ""
echo "🎉 СИСТЕМА ATLAS ПОЛНОСТЬЮ ЗАПУЩЕНА!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🤖 AI Agent Server:     http://localhost:3000   (PID: $GOOSE_PID)"
echo "🌐 Web Interface:       http://localhost:8080   (PID: $FRONTEND_PID)"  
echo "🗣️  Ukrainian TTS:       MCP Server Active      (PID: $TTS_PID)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 УПРАВЛЕНИЕ СИСТЕМОЙ:"
echo "   ⏹️  Остановка:  kill $GOOSE_PID $FRONTEND_PID $TTS_PID"
echo "   📊 Мониторинг: curl http://localhost:3000/health"
echo "   🌐 Интерфейс:  открыть http://localhost:8080"
echo ""
echo "📄 ЛОГИ СИСТЕМЫ:"
echo "   🤖 AI Agent:    tail -f /tmp/goose.log"
echo "   🌐 Frontend:    tail -f /tmp/frontend.log"
echo "   🗣️  TTS Server:  tail -f /tmp/tts.log"
echo ""
echo "💡 Система готова к работе! Откройте http://localhost:8080"
echo ""
echo "🖥️  Для запуска мониторинга системы выполните в другом терминале:"
echo "    ./monitor.sh"
echo ""

# Функция очистки при выходе
cleanup() {
    echo ""
    echo "🛑 Остановка системы ATLAS..."
    kill $GOOSE_PID $FRONTEND_PID $TTS_PID 2>/dev/null || true
    # Додатково зупиняємо процеси за іменем (на випадок, якщо PID змінилися)
    pkill -f goosed 2>/dev/null || true
    pkill -f atlas_minimal 2>/dev/null || true
    pkill -f mcp_tts 2>/dev/null || true
    echo "✅ Все компоненты остановлены"
    exit 0
}

# Перехват сигналів для корректного завершения
trap cleanup SIGINT SIGTERM

echo "🔧 Скрипт запущен. Для остановки нажмите Ctrl+C или выполните:"
echo "   kill $GOOSE_PID $FRONTEND_PID $TTS_PID"
echo ""

# Функція перевірки стану процесу та виведення логу у випадку помилки
check_process_status() {
    local pid=$1
    local name=$2
    local logfile=$3
    
    if ! kill -0 $pid 2>/dev/null; then
        echo "⚠️  Процес $name (PID: $pid) завершився неочікувано!"
        echo "📑 Останні 10 рядків логу $name:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        tail -10 $logfile
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        return 1
    fi
    return 0
}

# Ожидание сигнала завершения (но не блокируем терминал)
while true; do
    all_running=true
    
    # Перевіряємо кожен процес окремо
    check_process_status $GOOSE_PID "AI Agent" "/tmp/goose.log" || all_running=false
    check_process_status $FRONTEND_PID "Frontend" "/tmp/frontend.log" || all_running=false
    check_process_status $TTS_PID "TTS Server" "/tmp/tts.log" || all_running=false
    
    # Якщо хоч один процес завершився - зупиняємо всю систему
    if [ "$all_running" = "false" ]; then
        echo "⚠️  Один або кілька процесів завершилися. Зупиняємо систему..."
        cleanup
        break
    fi
    
    # Перевіряємо кожні 5 секунд
    sleep 5
done
