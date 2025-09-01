#!/bin/bash

# ATLAS Frontend v2.0 Launcher
# Запуск нового модульного фронтенду

set -e

# Кольори для виводу
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 ATLAS Frontend v2.0 - Starting...${NC}"

# Директорії
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ATLAS_ROOT="$SCRIPT_DIR"
FRONTEND_NEW_DIR="$ATLAS_ROOT/frontend_new"
APP_DIR="$FRONTEND_NEW_DIR/app"

echo -e "${BLUE}📁 Directories:${NC}"
echo -e "   Atlas Root: $ATLAS_ROOT"
echo -e "   Frontend:   $FRONTEND_NEW_DIR"
echo -e "   App:        $APP_DIR"

# Перевіряємо структуру
if [ ! -d "$FRONTEND_NEW_DIR" ]; then
    echo -e "${RED}❌ Frontend directory not found: $FRONTEND_NEW_DIR${NC}"
    exit 1
fi

if [ ! -f "$APP_DIR/atlas_server.py" ]; then
    echo -e "${RED}❌ Server file not found: $APP_DIR/atlas_server.py${NC}"
    exit 1
fi

# Python environment
VENV_PATH="$ATLAS_ROOT/frontend/venv"

echo -e "${BLUE}🐍 Python Environment:${NC}"
if [ -d "$VENV_PATH" ]; then
    echo -e "   Found venv: $VENV_PATH"
    source "$VENV_PATH/bin/activate"
    echo -e "${GREEN}   ✅ Virtual environment activated${NC}"
    
    # Показуємо версію Python
    PYTHON_VERSION=$(python --version 2>&1)
    echo -e "   Python: $PYTHON_VERSION"
    PIP_VERSION=$(pip --version 2>&1 | head -n1)
    echo -e "   Pip: $PIP_VERSION"
else
    echo -e "${YELLOW}   ⚠️  Virtual environment not found, using system Python${NC}"
fi

# Встановлюємо змінні оточення
export ATLAS_HOST=${ATLAS_HOST:-"127.0.0.1"}
export ATLAS_PORT=${ATLAS_PORT:-"5001"}  # Використовуємо інший порт
export ATLAS_DEBUG=${ATLAS_DEBUG:-"false"}

echo -e "${BLUE}🌐 Server Configuration:${NC}"
echo -e "   Host: $ATLAS_HOST"
echo -e "   Port: $ATLAS_PORT"
echo -e "   Debug: $ATLAS_DEBUG"

# Перевіряємо чи порт вільний
if lsof -Pi :$ATLAS_PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${YELLOW}⚠️  Port $ATLAS_PORT is already in use${NC}"
    
    # Знаходимо процес
    PID=$(lsof -Pi :$ATLAS_PORT -sTCP:LISTEN -t)
    if [ ! -z "$PID" ]; then
        echo -e "${YELLOW}   Process using port: PID $PID${NC}"
        ps -p $PID -o pid,ppid,cmd --no-headers || true
        
        echo -e "${YELLOW}   Killing process $PID...${NC}"
        kill -TERM $PID || true
        sleep 2
        
        # Перевіряємо чи процес завершився
        if kill -0 $PID 2>/dev/null; then
            echo -e "${RED}   Force killing process $PID...${NC}"
            kill -KILL $PID || true
            sleep 1
        fi
    fi
fi

# Перевіряємо залежності
echo -e "${BLUE}📦 Checking Dependencies:${NC}"

REQUIRED_PACKAGES=("flask" "requests")
MISSING_PACKAGES=()

for package in "${REQUIRED_PACKAGES[@]}"; do
    if python -c "import $package" 2>/dev/null; then
        echo -e "   ✅ $package"
    else
        echo -e "   ❌ $package"
        MISSING_PACKAGES+=("$package")
    fi
done

# Встановлюємо відсутні пакети
if [ ${#MISSING_PACKAGES[@]} -gt 0 ]; then
    echo -e "${YELLOW}📥 Installing missing packages...${NC}"
    for package in "${MISSING_PACKAGES[@]}"; do
        echo -e "   Installing $package..."
        pip install "$package" || {
            echo -e "${RED}❌ Failed to install $package${NC}"
            exit 1
        }
    done
fi

# Створюємо PID файл
PID_FILE="$ATLAS_ROOT/atlas_frontend_v2.pid"

# Функція очищення при виході
cleanup() {
    echo -e "\n${YELLOW}🛑 Shutting down Atlas Frontend v2.0...${NC}"
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo -e "   Terminating process $PID..."
            kill -TERM "$PID" 2>/dev/null || true
            sleep 2
            
            # Форсуємо завершення якщо потрібно
            if kill -0 "$PID" 2>/dev/null; then
                echo -e "   Force killing process $PID..."
                kill -KILL "$PID" 2>/dev/null || true
            fi
        fi
        rm -f "$PID_FILE"
    fi
    echo -e "${GREEN}✅ Cleanup completed${NC}"
    exit 0
}

# Встановлюємо обробники сигналів
trap cleanup EXIT INT TERM

# Змінюємо директорію на app
cd "$APP_DIR"

echo -e "${BLUE}🎯 Current Directory: $(pwd)${NC}"

# Запускаємо сервер
echo -e "${GREEN}🚀 Starting Atlas Frontend v2.0 Server...${NC}"
echo -e "${GREEN}   Access: http://$ATLAS_HOST:$ATLAS_PORT${NC}"
echo -e "${YELLOW}   Press Ctrl+C to stop${NC}"

# Записуємо PID
echo $$ > "$PID_FILE"

# Запускаємо Python сервер
python atlas_server.py &
SERVER_PID=$!

# Оновлюємо PID файл
echo "$SERVER_PID" > "$PID_FILE"

# Чекаємо доки сервер працює
wait "$SERVER_PID"
