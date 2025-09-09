#!/usr/bin/env python3
"""
Тест клієнта для перевірки retry логіки та dummy-key
"""

import sys
import os
sys.path.append(os.path.join(os.path.dirname(__file__), 'python_client'))

from python_client.client import GitHubModelsClient

def test_client():
    print("🧪 Тестування Python клієнта...")
    
    # Створюємо клієнта з dummy-key
    client = GitHubModelsClient(
        api_key="dummy-key",  # Використовуємо dummy-key
        proxy_url="http://localhost:3010/v1",
        max_retries=2,  # Менше спроб для швидкого тесту
        retry_delay=0.5  # Коротша затримка
    )
    
    print(f"✅ Клієнт створено з dummy-key")
    print(f"✅ Proxy URL: {client.base_url}")
    print(f"✅ Max retries: {client.max_retries}")
    print(f"✅ Retry delay: {client.retry_delay}s")
    
    # Тестуємо простий запит
    print("\n🔄 Тестування chat completion...")
    result = client.chat_completion(
        model="openai/gpt-4o-mini",
        messages=[{"role": "user", "content": "Привіт! Як справи?"}],
        max_tokens=50
    )
    
    if result['success']:
        print(f"✅ Успішний запит!")
        print(f"📝 Модель: {result['model']}")
        print(f"💬 Відповідь: {result['content'][:100]}...")
        print(f"📊 Токени: {result['usage']['total_tokens']}")
    else:
        print(f"❌ Помилка: {result['error']}")
    
    # Тестуємо отримання моделей
    print("\n📋 Перевірка доступних моделей...")
    models = client.get_models()
    print(f"✅ Знайдено {len(models)} моделей")
    
    # Показуємо перші 5 моделей
    for i, model in enumerate(models[:5]):
        print(f"  {i+1}. {model.id} ({model.provider}, {model.type})")

if __name__ == "__main__":
    test_client()
