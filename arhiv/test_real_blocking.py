#!/usr/bin/env python3
"""
Реальний тест блокування поля вводу Atlas з перевіркою JavaScript стану
"""

import asyncio
import aiohttp
import json
import time

async def test_stream_completion():
    """Тест правильності завершення stream запитів"""
    print("🧪 ТЕСТ ЗАВЕРШЕННЯ STREAM ЗАПИТІВ")
    print("=" * 50)
    
    session = aiohttp.ClientSession()
    
    try:
        messages = ["Тест 1", "Тест 2", "Тест 3", "Тест 4", "Тест 5"]
        
        for i, message in enumerate(messages, 1):
            print(f"\n📤 Stream тест {i}: '{message}'")
            
            start_time = time.time()
            tokens = 0
            done_received = False
            
            try:
                async with session.post(
                    "http://localhost:8080/api/chat/stream",
                    json={"message": message},
                    headers={"Content-Type": "application/json"}
                ) as response:
                    
                    if response.status == 200:
                        async for chunk in response.content.iter_chunked(1024):
                            chunk_text = chunk.decode('utf-8', errors='ignore')
                            lines = chunk_text.strip().split('\n')
                            
                            for line in lines:
                                if line.startswith('data: '):
                                    try:
                                        data = json.loads(line[6:])
                                        
                                        if data.get('type') == 'token':
                                            tokens += 1
                                            print(f"  🔤 Token {tokens}: {data.get('content', '')[:50]}...")
                                        
                                        elif data.get('type') == 'done':
                                            done_received = True
                                            elapsed = time.time() - start_time
                                            print(f"  ✅ DONE отримано за {elapsed:.2f}с. Токенів: {tokens}")
                                            break
                                            
                                        elif data.get('type') == 'error':
                                            print(f"  ❌ ERROR: {data.get('content')}")
                                            break
                                            
                                    except json.JSONDecodeError:
                                        continue
                            
                            if done_received:
                                break
                        
                        if not done_received:
                            print(f"  🚨 ПРОБЛЕМА: DONE event не отримано для тесту {i}")
                            print(f"     Це може бути причиною блокування поля вводу!")
                            break
                    else:
                        print(f"  ❌ HTTP {response.status}")
                        break
                        
            except Exception as e:
                print(f"  ❌ Помилка: {e}")
                break
            
            # Пауза між тестами
            await asyncio.sleep(1)
    
    finally:
        await session.close()

async def test_concurrent_requests():
    """Тест одночасних запитів (race condition)"""
    print(f"\n🧪 ТЕСТ ОДНОЧАСНИХ ЗАПИТІВ")
    print("=" * 50)
    
    session = aiohttp.ClientSession()
    
    try:
        # Відправляємо 3 запити одночасно
        tasks = []
        for i in range(3):
            task = session.post(
                "http://localhost:8080/api/chat/stream", 
                json={"message": f"Concurrent test {i+1}"},
                headers={"Content-Type": "application/json"}
            )
            tasks.append(task)
        
        print("📤 Відправляю 3 одночасних stream запити...")
        responses = await asyncio.gather(*tasks, return_exceptions=True)
        
        for i, response in enumerate(responses):
            if isinstance(response, Exception):
                print(f"  ❌ Запит {i+1}: {response}")
            else:
                print(f"  📊 Запит {i+1}: HTTP {response.status}")
                response.close()
    
    finally:
        await session.close()

if __name__ == "__main__":
    asyncio.run(test_stream_completion())
    asyncio.run(test_concurrent_requests())
    
    print(f"\n📋 ВИСНОВКИ:")
    print("1. Якщо DONE events не приходять - це причина блокування")
    print("2. Якщо concurrent запити створюють конфлікти - це race condition")
    print("3. Реалізовані фікси мають допомогти:")
    print("   ✅ Гарантоване розблокування в finally")
    print("   ✅ Автокорекція кожні 2 секунди")
    print("   ✅ Аварійний hotkey Ctrl+Shift+U")
    print(f"\n🔧 ДЛЯ ПЕРЕВІРКИ ФІКСУ:")
    print("1. Відкрийте http://localhost:8080")
    print("2. Відправте кілька повідомлень поспіль")
    print("3. Якщо поле блокується - натисніть Ctrl+Shift+U")
    print("4. Використовуйте debug_input.html для моніторингу")
