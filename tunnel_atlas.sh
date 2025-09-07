#!/bin/bash

# ATLAS Tunnel Script
# Запускає ngrok тунель для ATLAS системи

echo "🚀 Starting ATLAS Tunnel..."
echo "📡 Creating public tunnel for port 5001..."

# Перевіряємо, чи запущений локальний сервер
if ! curl -s http://localhost:5001 > /dev/null; then
    echo "❌ Local server on port 5001 is not running!"
    echo "Please start ATLAS system first with: ./start_stack_macos.sh"
    exit 1
fi

echo "✅ Local server is running"
echo "🌐 Starting ngrok tunnel..."
echo ""
echo "📋 Instructions:"
echo "1. Copy the HTTPS URL from ngrok output"
echo "2. Share this URL to access ATLAS remotely"
echo "3. Press Ctrl+C to stop the tunnel"
echo ""

# Запускаємо ngrok
ngrok http 5001
