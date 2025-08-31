#!/usr/bin/env python3
"""
Test script for Atlas TutorialChat Integration
Скрипт для тестування інтеграції TutorialChat з Atlas
"""

import json
import time
import requests
import threading
from pathlib import Path
import sys

def test_integration():
    """Тестує інтеграцію TutorialChat"""
    base_url = "http://localhost:8080"
    
    print("🧪 Тестування Atlas TutorialChat Integration...")
    print("=" * 50)
    
    # Тест 1: Перевірка конфігурації
    print("\n1. Тестування конфігурації...")
    try:
        response = requests.get(f"{base_url}/api/tutorialchat/config", timeout=5)
        if response.status_code == 200:
            config = response.json()
            print("✅ Конфігурація успішно завантажена")
            print(f"   API Base: {config.get('api_base_url')}")
            print(f"   Streaming: {config.get('streaming_enabled')}")
            print(f"   Version: {config.get('integration_metadata', {}).get('version')}")
        else:
            print(f"❌ Помилка конфігурації: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Помилка підключення: {e}")
        return False
    
    # Тест 2: Доступ до TutorialChat інтерфейсу
    print("\n2. Тестування веб-інтерфейсу...")
    try:
        response = requests.get(f"{base_url}/tutorialchat", timeout=5)
        if response.status_code == 200:
            print("✅ TutorialChat інтерфейс доступний")
        else:
            print(f"❌ Помилка доступу до інтерфейсу: {response.status_code}")
    except Exception as e:
        print(f"❌ Помилка доступу: {e}")
    
    # Тест 3: Тестування API чату
    print("\n3. Тестування chat API...")
    try:
        chat_data = {
            "message": "Тестове повідомлення для перевірки інтеграції",
            "session_name": f"test_session_{int(time.time())}",
            "session_type": "chat"
        }
        
        print(f"   Надсилається: {chat_data['message']}")
        response = requests.post(f"{base_url}/api/chat/reply", 
                               json=chat_data, 
                               timeout=10,
                               stream=True)
        
        if response.status_code == 200:
            print("✅ API чату відповідає")
            
            # Читаємо перші кілька подій з SSE потоку
            event_count = 0
            max_events = 3
            
            for line in response.iter_lines():
                if line:
                    line = line.decode('utf-8')
                    if line.startswith('data: '):
                        event_data = line[6:]  # Прибираємо "data: "
                        if event_data == '[DONE]':
                            print("✅ Потік успішно завершено")
                            break
                        
                        try:
                            event = json.loads(event_data)
                            print(f"   📨 Подія {event_count + 1}: {event.get('type', 'unknown')}")
                            event_count += 1
                            
                            if event_count >= max_events:
                                print(f"   📊 Отримано {event_count} подій, завершуємо тест")
                                break
                                
                        except json.JSONDecodeError:
                            print(f"   ⚠️ Неможливо розпарсити подію: {event_data[:100]}")
                            
                        except Exception as e:
                            print(f"   ❌ Помилка обробки події: {e}")
                            
            print(f"✅ Тест API успішний ({event_count} подій)")
            
        else:
            print(f"❌ API помилка: {response.status_code}")
            print(f"   Response: {response.text[:200]}")
            
    except Exception as e:
        print(f"❌ Помилка тестування API: {e}")
    
    # Тест 4: Тестування створення сесії
    print("\n4. Тестування API сесій...")
    try:
        session_data = {
            "metadata": {
                "test": True,
                "timestamp": time.time()
            }
        }
        
        response = requests.post(f"{base_url}/api/session", 
                               json=session_data, 
                               timeout=5)
        
        if response.status_code == 201:
            session = response.json()
            print("✅ Сесія успішно створена")
            print(f"   Session ID: {session.get('session_id')}")
            print(f"   Status: {session.get('status')}")
        else:
            print(f"❌ Помилка створення сесії: {response.status_code}")
            
    except Exception as e:
        print(f"❌ Помилка тестування сесії: {e}")
    
    print("\n" + "=" * 50)
    print("🎯 Тестування завершено!")
    print("\nДля повного тестування відкрийте:")
    print(f"   🌐 Web Interface: {base_url}/tutorialchat")
    print(f"   📊 Atlas Status: {base_url}/api/status")
    print(f"   ⚙️ Config: {base_url}/api/tutorialchat/config")
    
    return True


def monitor_logs():
    """Моніторинг логів під час тестування"""
    try:
        response = requests.get("http://localhost:8080/logs/stream", 
                               timeout=30, stream=True)
        
        print("\n📋 Лог моніторинг активний...")
        for line in response.iter_lines():
            if line:
                print(f"📝 {line.decode('utf-8')}")
                
    except Exception as e:
        print(f"⚠️ Лог моніторинг недоступний: {e}")


if __name__ == "__main__":
    print("🚀 Atlas TutorialChat Integration Tester")
    print("Переконайтеся, що сервер запущений на localhost:8080")
    
    # Можливість запуску моніторингу в фоні
    if len(sys.argv) > 1 and sys.argv[1] == "--monitor":
        log_thread = threading.Thread(target=monitor_logs, daemon=True)
        log_thread.start()
        time.sleep(1)  # Дати час для підключення
    
    test_integration()
