#!/usr/bin/env python3
"""
🛠️ Швидкий тест блокування після Atlas Core виправлень
"""

import asyncio
import aiohttp
import json
import time

async def test_atlas_stream():
    """Тестування стріму Atlas Core"""
    url = 'http://localhost:8080/api/chat/stream'
    
    async with aiohttp.ClientSession() as session:
        print("🧪 Тестування Atlas Core stream...")
        
        payload = {
            'message': 'Привіт! Як справи?'
        }
        
        start_time = time.time()
        
        try:
            async with session.post(url, json=payload) as response:
                print(f"📡 Status: {response.status}")
                print(f"📡 Headers: {dict(response.headers)}")
                
                if response.status != 200:
                    text = await response.text()
                    print(f"❌ Error response: {text}")
                    return False
                    
                # Читання стріму
                full_response = ""
                events_count = 0
                
                async for line in response.content:
                    line_str = line.decode('utf-8').strip()
                    
                    if not line_str or line_str.startswith(':'):
                        continue
                        
                    if line_str.startswith('data:'):
                        events_count += 1
                        json_str = line_str[5:].strip()
                        
                        try:
                            obj = json.loads(json_str)
                            
                            # Goose format
                            if obj.get('type') == 'token':
                                full_response += obj.get('token', '')
                            elif obj.get('type') == 'done':
                                print("✅ Stream completed (Goose format)")
                            
                            # Atlas Core format  
                            elif obj.get('event') == 'final':
                                full_response += obj.get('atlas_response', obj.get('response', ''))
                                print("✅ Stream completed (Atlas Core format)")
                                
                        except json.JSONDecodeError:
                            # Plain text token
                            full_response += json_str
                            
                end_time = time.time()
                
                print(f"📊 Events received: {events_count}")
                print(f"⏱️ Duration: {end_time - start_time:.2f}s")
                print(f"💬 Response length: {len(full_response)} chars")
                print(f"📝 Response preview: {full_response[:200]}...")
                
                return len(full_response) > 0
                
        except Exception as e:
            print(f"❌ Exception: {e}")
            return False

async def test_input_blocking_sequence():
    """Послідовний тест кількох запитів"""
    print("\n" + "="*50)
    print("🔄 Тестування послідовних запитів")
    print("="*50)
    
    messages = [
        "Тест 1",
        "Тест 2", 
        "Тест 3"
    ]
    
    for i, msg in enumerate(messages, 1):
        print(f"\n📤 Запит {i}: {msg}")
        success = await test_atlas_stream()
        
        if success:
            print(f"✅ Запит {i} успішний")
        else:
            print(f"❌ Запит {i} неуспішний")
            
        # Невелика затримка між запитами
        await asyncio.sleep(2)

async def main():
    print("🚀 Atlas Core Stream Test")
    print("-" * 30)
    
    # Перевірка доступності
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get('http://localhost:8080/api/status') as response:
                if response.status == 200:
                    status = await response.json()
                    print(f"✅ Server status: {status}")
                else:
                    print(f"⚠️ Server status: {response.status}")
    except Exception as e:
        print(f"❌ Server unavailable: {e}")
        return
    
    # Основний тест
    await test_input_blocking_sequence()
    
    print("\n" + "="*50)
    print("✅ Всі тести завершено!")
    print("="*50)

if __name__ == "__main__":
    asyncio.run(main())
