#!/usr/bin/env python3
"""
ATLAS OpenAI SDK Integration Demo
Демонстрація використання OpenAI SDK з компактними моделями ATLAS
"""

import os
import time
import asyncio
from openai import OpenAI, AsyncOpenAI

# Налаштування клієнта для локального проксі
client = OpenAI(
    api_key="dummy-key",  # Для локального проксі може бути будь-яким
    base_url="http://localhost:3010/v1"
)

# Асинхронний клієнт для паралельних запитів
async_client = AsyncOpenAI(
    api_key="dummy-key",
    base_url="http://localhost:3010/v1"
)

# Компактні моделі для тестування
COMPACT_MODELS = [
    "openai/gpt-4o-mini",
    "microsoft/phi-3.5-mini-instruct", 
    "mistral-ai/ministral-3b",
    "microsoft/phi-3-mini-4k-instruct",
    "meta/meta-llama-3.1-8b-instruct"
]

def test_single_model(model, message="Привіт! Як справи?"):
    """Тест одної моделі"""
    print(f"\n🤖 Тестування {model}")
    print("=" * 50)
    
    start_time = time.time()
    
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Ви - корисний AI асистент."},
                {"role": "user", "content": message}
            ],
            max_tokens=500,
            temperature=0.7
        )
        
        duration = time.time() - start_time
        content = response.choices[0].message.content
        tokens = response.usage.total_tokens if response.usage else 0
        
        print(f"⏱️  Час відповіді: {duration:.2f}с")
        print(f"🎯 Токенів: {tokens}")
        print(f"📝 Відповідь: {content[:200]}...")
        
        return {
            "model": model,
            "success": True,
            "duration": duration,
            "tokens": tokens,
            "content": content
        }
        
    except Exception as error:
        duration = time.time() - start_time
        print(f"❌ Помилка: {error}")
        
        return {
            "model": model,
            "success": False,
            "duration": duration,
            "error": str(error)
        }

def test_streaming(model="mistral-ai/ministral-3b", message="Розкажи короткий анекдот"):
    """Тест потокової передачі"""
    print(f"\n🌊 Streaming тест з {model}")
    print("=" * 50)
    
    try:
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": message}],
            max_tokens=300,
            temperature=0.8,
            stream=True
        )
        
        print("📡 Потокова відповідь:")
        for chunk in stream:
            content = chunk.choices[0].delta.content or ""
            print(content, end="", flush=True)
        
        print("\n✅ Streaming завершено")
        
    except Exception as error:
        print(f"❌ Streaming помилка: {error}")

async def test_async_multiple():
    """Асинхронний тест кількох моделей"""
    print(f"\n⚡ Асинхронний тест кількох моделей")
    print("=" * 50)
    
    prompt = "Напиши короткий вірш про програмування"
    
    # Створюємо завдання для всіх моделей
    tasks = []
    for model in COMPACT_MODELS[:3]:  # Беремо перші 3 для демо
        task = async_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
            temperature=0.7
        )
        tasks.append((model, task))
    
    # Запускаємо паралельно
    start_time = time.time()
    results = []
    
    for model, task in tasks:
        try:
            response = await task
            results.append({
                "model": model,
                "success": True,
                "content": response.choices[0].message.content
            })
        except Exception as error:
            results.append({
                "model": model,
                "success": False,
                "error": str(error)
            })
    
    duration = time.time() - start_time
    
    print(f"⏱️  Загальний час: {duration:.2f}с")
    
    for result in results:
        print(f"\n🤖 {result['model']}:")
        if result['success']:
            print(f"✅ {result['content'][:100]}...")
        else:
            print(f"❌ {result['error']}")

def compare_models_performance():
    """Порівняння продуктивності моделей"""
    print(f"\n📊 Порівняння продуктивності компактних моделей")
    print("=" * 60)
    
    test_prompt = "Поясни що таке Python у 2-3 реченнях"
    results = []
    
    for model in COMPACT_MODELS:
        result = test_single_model(model, test_prompt)
        results.append(result)
        time.sleep(1)  # Невелика пауза між запитами
    
    # Сортуємо за швидкістю
    successful_results = [r for r in results if r.get('success')]
    successful_results.sort(key=lambda x: x['duration'])
    
    print(f"\n🏆 Рейтинг за швидкістю:")
    for i, result in enumerate(successful_results, 1):
        print(f"{i}. {result['model']}: {result['duration']:.2f}с ({result['tokens']} токенів)")

def test_different_tasks():
    """Тест різних типів завдань"""
    tasks = {
        "Код": "Створи функцію для сортування списку на Python",
        "Аналіз": "Проаналізуй переваги та недоліки React vs Vue.js",
        "Креативність": "Напиши невеликий вірш про штучний інтелект",
        "Факти": "Назви 3 найбільші країни світу за площею"
    }
    
    # Використовуємо найшвидшу модель для всіх завдань
    model = "mistral-ai/ministral-3b"
    
    print(f"\n🎯 Тест різних завдань з {model}")
    print("=" * 60)
    
    for task_name, prompt in tasks.items():
        print(f"\n📋 Завдання: {task_name}")
        print("-" * 30)
        
        result = test_single_model(model, prompt)
        if result.get('success'):
            print(f"✅ Успішно за {result['duration']:.2f}с")
        else:
            print(f"❌ Помилка: {result.get('error')}")

def main():
    """Головна функція демонстрації"""
    print("🚀 ATLAS OpenAI SDK Integration Demo")
    print("=" * 60)
    
    # Перевіримо доступність сервера
    try:
        models = client.models.list()
        print(f"✅ Сервер доступний, моделей: {len(models.data)}")
    except Exception as error:
        print(f"❌ Сервер недоступний: {error}")
        print("🔧 Запустіть fallback сервер: node fallback_llm/server_sdk.js")
        return
    
    # Послідовність тестів
    test_single_model(COMPACT_MODELS[0])
    test_streaming()
    
    # Асинхронний тест
    asyncio.run(test_async_multiple())
    
    # Порівняння продуктивності
    compare_models_performance()
    
    # Тест різних завдань
    test_different_tasks()
    
    print(f"\n🎉 Демонстрація завершена!")
    print("💡 Тепер ви можете використовувати OpenAI SDK з ATLAS!")

if __name__ == "__main__":
    main()
