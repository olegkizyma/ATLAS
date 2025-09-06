#!/usr/bin/env python3
"""
Тестовий скрипт для перевірки підключення до Goose
"""

import sys
import os
sys.path.append('/Users/dev/Documents/GitHub/ATLAS/frontend_new/app')

from goose_client import GooseClient

def test_goose():
    print("🧪 Тестую підключення до Goose...")
    
    client = GooseClient()
    print(f"📍 Base URL: {client.base_url}")
    
    # Перевіряємо тип з'єднання
    is_web = client._is_web()
    is_goosed = client._is_goosed()
    
    print(f"🌐 Is Web: {is_web}")
    print(f"🔧 Is Goosed: {is_goosed}")
    
    if is_web:
        print("✅ Знайдено Goose Web на порті 3000")
        print("🔄 Тестую WebSocket з'єднання...")
        
        try:
            result = client.send_reply("test_session", "Привіт! Це тест з'єднання.", timeout=10)
            print(f"📝 Результат: {result}")
            if result.get('success'):
                print("🎉 WebSocket з'єднання працює!")
            else:
                print(f"❌ Помилка WebSocket: {result.get('error')}")
        except Exception as e:
            print(f"💥 Виняток під час тестування: {e}")
    
    elif is_goosed:
        print("✅ Знайдено Goosed API")
        print("🔄 Тестую SSE з'єднання...")
        
        try:
            result = client.send_reply("test_session", "Привіт! Це тест з'єднання.", timeout=10)
            print(f"📝 Результат: {result}")
            if result.get('success'):
                print("🎉 SSE з'єднання працює!")
            else:
                print(f"❌ Помилка SSE: {result.get('error')}")
        except Exception as e:
            print(f"💥 Виняток під час тестування: {e}")
    
    else:
        print("❌ Goose не знайдено або не відповідає")

if __name__ == "__main__":
    test_goose()
