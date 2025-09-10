#!/usr/bin/env python3
"""
Приклад запиту до моделі microsoft/phi-3-mini-4k-instruct через ATLAS client-module
"""

import sys
import os

# Додаємо шлях до client-module
client_path = os.path.join(os.path.dirname(__file__), 'client-module', 'python_client')
sys.path.append(client_path)

from client import GitHubModelsClient

def main():
    """Демонстрація роботи з microsoft/phi-3-mini-4k-instruct"""
    
    # Ініціалізуємо клієнт (використовуємо локальний прокси ATLAS)
    client = GitHubModelsClient(
        proxy_url="http://localhost:5101/v1",  # ATLAS orchestrator API
        api_key="dummy-key"
    )
    
    # Модель для використання
    model_name = "microsoft/phi-3-mini-4k-instruct"
    
    print(f"🤖 Тестуємо модель: {model_name}")
    print("=" * 50)
    
    try:
        # Простий запит
        print("📝 Простий запит:")
        response = client.chat_completion(
            model=model_name,
            messages=[
                {"role": "user", "content": "Розкажи мені коротко про штучний інтелект українською мовою"}
            ],
            max_tokens=500,
            temperature=0.7
        )
        
        print(f"Відповідь: {response.choices[0].message.content}")
        print(f"Токенів використано: {response.usage.total_tokens}")
        print()
        
        # Складніший запит з контекстом
        print("🧠 Запит з контекстом:")
        context_response = client.chat_completion(
            model=model_name,
            messages=[
                {"role": "system", "content": "Ти - досвідчений програміст Python, який допомагає з кодом."},
                {"role": "user", "content": "Напиши простий приклад використання декораторів в Python"}
            ],
            max_tokens=800,
            temperature=0.5
        )
        
        print(f"Відповідь: {context_response.choices[0].message.content}")
        print(f"Токенів використано: {context_response.usage.total_tokens}")
        print()
        
        # Креативний запит
        print("🎨 Креативний запит:")
        creative_response = client.chat_completion(
            model=model_name,
            messages=[
                {"role": "user", "content": "Придумай короткий вірш про програмування українською мовою"}
            ],
            max_tokens=300,
            temperature=1.0
        )
        
        print(f"Відповідь: {creative_response.choices[0].message.content}")
        print(f"Токенів використано: {creative_response.usage.total_tokens}")
        
    except Exception as e:
        print(f"❌ Помилка: {e}")
        print("\n🔧 Перевірте, що:")
        print("1. ATLAS система запущена (./restart_simple.sh)")
        print("2. Orchestrator працює на порту 5101")
        print("3. Модель доступна в models.json")

if __name__ == "__main__":
    main()
