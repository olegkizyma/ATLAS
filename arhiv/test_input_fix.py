#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Скрипт для тестування Atlas API та перевірки проблеми з блокуванням поля вводу
"""

import asyncio
import json
import time
import aiohttp
from datetime import datetime

async def test_atlas_stream_api():
    """Тестує стрімінговий API Atlas"""
    print("🚀 Тестування Atlas Stream API...")
    
    test_message = "Привіт Atlas! Це тестове повідомлення для перевірки блокування поля вводу."
    
    async with aiohttp.ClientSession() as session:
        try:
            print(f"📤 Відправляю повідомлення: '{test_message}'")
            
            async with session.post(
                'http://localhost:8080/api/chat/stream',
                json={'message': test_message},
                headers={'Content-Type': 'application/json'}
            ) as response:
                
                if response.status != 200:
                    print(f"❌ HTTP помилка: {response.status}")
                    return
                
                print("📡 Отримую відповідь стрімом...")
                buffer = ''
                
                async for chunk in response.content.iter_chunked(1024):
                    chunk_text = chunk.decode('utf-8')
                    buffer += chunk_text
                    
                    # Обробляємо повні лінії
                    while '\n' in buffer:
                        line, buffer = buffer.split('\n', 1)
                        line = line.strip()
                        
                        if line.startswith('data:'):
                            data = line[5:].strip()
                            try:
                                event = json.loads(data)
                                event_type = event.get('type', event.get('event', 'unknown'))
                                print(f"  📨 {event_type}: {json.dumps(event, ensure_ascii=False)[:100]}...")
                            except json.JSONDecodeError:
                                print(f"  📨 text: {data[:50]}...")
                
                print("✅ Стрім завершено успішно")
                
        except Exception as e:
            print(f"❌ Помилка: {e}")

async def test_atlas_regular_api():
    """Тестує звичайний API Atlas"""
    print("\n🚀 Тестування Atlas Regular API...")
    
    test_message = "Це тест звичайного API без стрімінгу"
    
    async with aiohttp.ClientSession() as session:
        try:
            print(f"📤 Відправляю повідомлення: '{test_message}'")
            
            async with session.post(
                'http://localhost:8080/api/chat',
                json={'message': test_message},
                headers={'Content-Type': 'application/json'}
            ) as response:
                
                if response.status != 200:
                    print(f"❌ HTTP помилка: {response.status}")
                    return
                
                data = await response.json()
                print(f"✅ Відповідь отримана: {json.dumps(data, ensure_ascii=False)[:200]}...")
                
        except Exception as e:
            print(f"❌ Помилка: {e}")

async def test_status_endpoint():
    """Тестує статус ендпойнт"""
    print("\n🚀 Перевірка статусу системи...")
    
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get('http://localhost:8080/api/status') as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"📊 Статус системи: {json.dumps(data, ensure_ascii=False, indent=2)}")
                else:
                    print(f"❌ Статус недоступний: HTTP {response.status}")
        except Exception as e:
            print(f"❌ Помилка статусу: {e}")

async def test_goose_sessions():
    """Перевіряє Goose сесії"""
    print("\n🚀 Перевірка Goose сесій...")
    
    async with aiohttp.ClientSession() as session:
        try:
            async with session.get('http://localhost:8080/api/goose/sessions') as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"🪿 Goose сесії: {json.dumps(data, ensure_ascii=False, indent=2)}")
                else:
                    print(f"❌ Goose сесії недоступні: HTTP {response.status}")
        except Exception as e:
            print(f"❌ Помилка Goose сесій: {e}")

async def main():
    """Головна функція тестування"""
    print(f"🧪 Atlas Input Fix Test - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Тестуємо всі компоненти
    await test_status_endpoint()
    await test_goose_sessions()
    await test_atlas_regular_api()
    await test_atlas_stream_api()
    
    print("\n" + "=" * 60)
    print("🎯 Тестування завершено!")
    print("\nЯкщо поле вводу все ще блокується:")
    print("1. Спробуйте натиснути Ctrl+Shift+U в інтерфейсі Atlas")
    print("2. Перезавантажте сторінку (F5)")
    print("3. Перевірте консоль браузера на наявність помилок")

if __name__ == "__main__":
    asyncio.run(main())
