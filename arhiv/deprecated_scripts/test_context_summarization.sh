#!/bin/bash

# Test Smart Context Summarization System
echo "🧠 Тестування Smart Context Summarization System..."

# 1. Перевірка чи працює сервер
echo "📡 Перевірка доступності orchestrator..."
if curl -s http://127.0.0.1:5101/context/stats >/dev/null 2>&1; then
    echo "✅ Orchestrator працює"
else
    echo "❌ Orchestrator недоступний. Запускаю..."
    cd /Users/dev/Documents/GitHub/ATLAS
    source context_limits.env
    ./start_stack.sh &
    sleep 5
fi

# 2. Перевірка стану контексту
echo "📊 Поточний стан контексту:"
curl -s http://127.0.0.1:5101/context/stats | jq .

# 3. Тестування з великим контекстом
echo "🔍 Тестування з великим повідомленням..."
TEST_MESSAGE="Це дуже довге повідомлення яке повинно тестувати систему обробки контексту. Ця система повинна автоматично підсумовувати попередній контекст і зберігати лише останні взаємодії плюс підсумок попередніх. $(for i in {1..100}; do echo -n "Тестовий текст номер $i для збільшення розміру повідомлення. "; done)"

curl -X POST http://127.0.0.1:5101/chat/stream \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"$TEST_MESSAGE\",\"sessionId\":\"test-context-session\"}" \
  2>/dev/null | head -20

# 4. Перевірка оновленого стану
echo "📈 Стан після обробки:"
curl -s http://127.0.0.1:5101/context/stats | jq .

# 5. Перевірка форматованого контексту
echo "📝 Форматований контекст:"
curl -s http://127.0.0.1:5101/context/formatted | jq .formattedContext | head -10

echo "✨ Тестування завершено!"
