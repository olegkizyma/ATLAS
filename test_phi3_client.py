#!/usr/bin/env python3
"""
Тест клієнта для microsoft/phi-3-mini-4k-instruct
"""

import sys
import os
sys.path.append('/Users/dev/Documents/GitHub/ATLAS/client-module/python_client')

from client import GitHubModelsClient

def test_phi3_mini():
    """Тестуємо модель microsoft/phi-3-mini-4k-instruct"""
    
    print("🚀 Тестуємо модель microsoft/phi-3-mini-4k-instruct")
    print("=" * 50)
    
    # Створюємо клієнт (він автоматично підхопить .env)
    client = GitHubModelsClient(
        proxy_url="http://localhost:5101/v1"
    )
    
    # Тестове повідомлення українською
    test_message = "Розкажи коротко про штучний інтелект українською мовою. Максимум 3 речення."
    
    print(f"📝 Запит: {test_message}")
    print("-" * 50)
    
    try:
        # Викликаємо модель
        result = client.chat_completion(
            model="microsoft/phi-3-mini-4k-instruct",
            messages=[
                {"role": "user", "content": test_message}
            ],
            max_tokens=200,
            temperature=0.7
        )
        
        print(f"✅ Успіх!")
        print(f"🤖 Модель: {result.get('model', 'невідомо')}")
        print(f"💬 Відповідь: {result.get('content', 'немає відповіді')}")
        print(f"📊 Токени: {result.get('usage', {}).get('total_tokens', 'невідомо')}")
        
    except Exception as e:
        print(f"❌ Помилка: {e}")
        print(f"🔍 Тип помилки: {type(e).__name__}")

if __name__ == "__main__":
    test_phi3_mini()
