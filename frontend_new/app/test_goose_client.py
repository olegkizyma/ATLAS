#!/usr/bin/env python3
"""
Автоматичний тест GooseVisionClient
"""

import asyncio
import sys
import os

# Add the current directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from goose_vision_client import GooseVisionClient

async def test_client():
    print("🧪 Автоматичний тест GooseVisionClient...")
    
    client = GooseVisionClient()
    
    try:
        # Test setup
        print("🔌 Тест підключення...")
        setup_result = await client.setup_agent()
        if setup_result:
            print("✅ Підключення успішне")
        else:
            print("❌ Підключення неуспішне")
            return
        
        # Test calculator
        print("\n🧮 Тест калькулятора...")
        calc_result = await client.execute_calculator({"operation": "add", "numbers": [2, 3, 5]})
        print(f"Результат обчислення: {calc_result}")
        
        # Test chat with simple message
        print("\n💬 Тест чату...")
        chat_result = await client.chat_with_vision("Привіт! Як справи?")
        print(f"Відповідь чату: {chat_result}")
        
        # Test screenshot analysis
        print("\n📸 Тест аналізу екрану...")
        screen_result = await client.analyze_current_screen()
        if screen_result["success"]:
            print(f"✅ Аналіз екрану успішний:")
            print(f"   Аналіз: {screen_result['analysis'][:100]}...")
            print(f"   Файл: {screen_result.get('image_path', 'N/A')}")
        else:
            print(f"❌ Помилка аналізу екрану: {screen_result['error']}")
        
        # Test screenshot command in chat
        print("\n🗣️ Тест команди скріншот в чаті...")
        screenshot_chat = await client.chat_with_vision("screenshot")
        print(f"Відповідь на команду скріншот: {screenshot_chat[:100]}...")
        
        print("\n✅ Всі тести завершені!")
        
    except Exception as e:
        print(f"❌ Помилка тесту: {str(e)}")

if __name__ == "__main__":
    try:
        asyncio.run(test_client())
    except KeyboardInterrupt:
        print("\n👋 Тест перервано користувачем")
    except Exception as e:
        print(f"❌ Помилка запуску тесту: {str(e)}")
