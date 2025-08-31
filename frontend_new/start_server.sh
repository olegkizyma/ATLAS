#!/bin/bash

# ATLAS Frontend v2.0 Launcher
echo "🚀 Starting ATLAS Frontend v2.0..."

# Перехід до директорії
cd "$(dirname "$0")"
FRONTEND_DIR="/Users/dev/Documents/GitHub/ATLAS/frontend_new"
VENV_PYTHON="/Users/dev/Documents/GitHub/ATLAS/frontend/venv/bin/python"

echo "📁 Working directory: $FRONTEND_DIR/app"
echo "🐍 Python: $VENV_PYTHON"

# Перевіряємо чи існує Python
if [ ! -f "$VENV_PYTHON" ]; then
    echo "❌ Python virtual environment not found!"
    echo "Expected: $VENV_PYTHON"
    exit 1
fi

# Перехід до app директорії і запуск на порту 5001
cd "$FRONTEND_DIR/app"

echo "🌐 Starting server on http://127.0.0.1:5001"
echo "Press Ctrl+C to stop"
echo ""

ATLAS_PORT=5001 "$VENV_PYTHON" atlas_server.py
