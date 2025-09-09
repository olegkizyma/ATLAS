#!/usr/bin/env python3
"""
Простий демо скрипт для тестування GooseVisionClient
"""

import asyncio
import sys
import os

# Add the current directory to path for imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from goose_vision_client import GooseVisionClient

async def main():
    print("🚀 Запуск простого демо ATLAS Goose Vision...")
    
    client = GooseVisionClient()
    
    try:
        # Initialize client
        print("🔌 Підключення до Goose...")
        init_result = await client.setup_agent()
        if not init_result:
            print(f"❌ Не вдалося підключитися до Goose")
            return
        
        print(f"✅ Підключено до Goose успішно")
        
        # Demo scenarios
        while True:
            print("\n" + "="*50)
            print("🎯 Оберіть демо сценарій:")
            print("1. 📸 Аналіз скріншоту")
            print("2. 🧮 Калькулятор")
            print("3. 💬 Чат з Goose")
            print("4. ⚡ Швидкий аналіз екрану")
            print("5. 🗣️ Чат з командами (screenshot/скріншот)")
            print("0. ❌ Вихід")
            
            choice = input("\nВаш вибір: ").strip()
            
            if choice == "0":
                break
            elif choice == "1":
                print("📸 Аналіз скріншоту...")
                result = await client.execute_vision_analysis({"image_path": "screenshot.png"})
                print(f"Результат: {result}")
            elif choice == "2":
                operation = input("Введіть операцію (add/subtract/multiply/divide): ")
                numbers_str = input("Введіть числа через кому: ")
                try:
                    numbers = [float(x.strip()) for x in numbers_str.split(',')]
                    result = await client.execute_calculator({"operation": operation, "numbers": numbers})
                    print(f"Результат: {result}")
                except ValueError:
                    print("❌ Невірний формат чисел")
            elif choice == "3":
                message = input("Ваше повідомлення для Goose: ")
                response = await client.chat_with_vision(message)
                print(f"Відповідь: {response}")
            elif choice == "4":
                print("⚡ Швидкий аналіз поточного екрану...")
                result = await client.analyze_current_screen()
                if result["success"]:
                    print(f"✅ Аналіз: {result['analysis']}")
                    print(f"📁 Файл: {result.get('image_path', 'N/A')}")
                    print(f"⏰ Час: {result.get('timestamp', 'N/A')}")
                else:
                    print(f"❌ Помилка: {result['error']}")
            elif choice == "5":
                print("🗣️ Інтерактивний чат з командами:")
                print("💡 Підказка: введіть 'screenshot' або 'скріншот' для аналізу екрану")
                while True:
                    message = input("\nВи: ").strip()
                    if message.lower() in ['exit', 'quit', 'вихід']:
                        break
                    response = await client.chat_with_vision(message)
                    print(f"Goose: {response}")
            else:
                print("❌ Невірний вибір")
    
    except Exception as e:
        print(f"❌ Помилка: {str(e)}")
    finally:
        print("🔌 Завершення роботи...")
        # client.close() метод не існує, просто виходимо

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Демо перервано користувачем")
    except Exception as e:
        print(f"❌ Помилка запуску: {str(e)}")
