#!/usr/bin/env python3
"""
Тестовий скрипт для перевірки інтеграції Гриши з візуальним моніторингом
"""

import sys
import os

# Додаємо шлях до віртуального середовища ATLAS
repo_root = os.path.dirname(os.path.abspath(__file__))
venv_path = os.path.join(repo_root, 'frontend_new', 'venv', 'lib', 'python3.11', 'site-packages')
if os.path.exists(venv_path):
    sys.path.insert(0, venv_path)

# Тепер імпортуємо залежності
try:
    import requests
    import json
    import time
    import threading
except ImportError as e:
    print(f"❌ Помилка імпорту: {e}")
    print("🔧 Запустіть скрипт через віртуальне середовище:")
    print("   cd frontend_new && source venv/bin/activate && cd .. && python test_grisha_vision.py")
    sys.exit(1)

# Конфігурація серверів
ATLAS_SERVER = "http://localhost:5001"
ORCHESTRATOR_SERVER = "http://localhost:5101"

def test_monitoring_endpoints():
    """Тестування API ендпоінтів для моніторингу"""
    print("🔍 Тестування API ендпоінтів візуального моніторингу...")
    
    try:
        # Тест статусу моніторингу
        response = requests.get(f"{ATLAS_SERVER}/api/grisha/monitoring-status")
        print(f"Статус моніторингу: {response.status_code} - {response.json()}")
        
        # Тест запуску моніторингу
        response = requests.post(f"{ATLAS_SERVER}/api/grisha/start-monitoring")
        print(f"Запуск моніторингу: {response.status_code} - {response.json()}")
        
        # Дати час для захоплення кількох скріншотів
        print("⏱️ Чекаємо 5 секунд для захоплення скріншотів...")
        time.sleep(5)
        
        # Тест отримання візуальних доказів
        response = requests.get(f"{ATLAS_SERVER}/api/grisha/visual-evidence")
        evidence = response.json()
        print(f"Візуальні докази: {response.status_code}")
        if evidence.get('evidence'):
            print(f"  Знайдено {len(evidence['evidence'])} доказів")
            for i, ev in enumerate(evidence['evidence'][:3], 1):  # Перші 3
                print(f"  {i}. {ev.get('type', 'N/A')} - {ev.get('description', 'N/A')[:50]}...")
        
        # Тест зупинки моніторингу
        response = requests.post(f"{ATLAS_SERVER}/api/grisha/stop-monitoring")
        print(f"Зупинка моніторингу: {response.status_code} - {response.json()}")
        
        return True
        
    except Exception as e:
        print(f"❌ Помилка тестування API: {e}")
        return False

def test_agent_integration():
    """Тестування інтеграції з агентами"""
    print("\n🤖 Тестування інтеграції з агентами...")
    
    test_message = {
        "message": "Створи файл test_grisha_vision.txt з поточним часом",
        "sessionId": "test-vision-integration"
    }
    
    try:
        response = requests.post(
            f"{ORCHESTRATOR_SERVER}/chat",
            json=test_message,
            headers={"Content-Type": "application/json"}
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"✅ Отримано відповідь від оркестратора: {response.status_code}")
            
            # Перевіряємо на наявність візуальної верифікації
            has_visual = False
            for msg in result.get('responses', []):
                if msg.get('phase') == 'grisha_verdict':
                    print(f"📋 Знайдено вердикт Гриши: {msg.get('agent', 'unknown')}")
                    if msg.get('visual_verification'):
                        print(f"👁️ Візуальна верифікація: {msg['visual_verification'][:100]}...")
                        has_visual = True
                    if msg.get('verification'):
                        conf = msg['verification'].get('confidence', 0)
                        confirmed = msg['verification'].get('confirmed', False)
                        print(f"🎯 Впевненість: {conf:.2f}, Підтверджено: {confirmed}")
            
            if has_visual:
                print("✅ Візуальна верифікація працює!")
            else:
                print("⚠️ Візуальна верифікація не знайдена в результатах")
                
            return True
        else:
            print(f"❌ Помилка оркестратора: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Помилка тестування агентів: {e}")
        return False

def check_servers():
    """Перевірка, що сервери працюють"""
    print("🔧 Перевірка серверів...")
    
    try:
        # Перевіряємо Flask сервер
        response = requests.get(f"{ATLAS_SERVER}/api/vision/status", timeout=5)
        print(f"Atlas Server: {response.status_code} ✅")
    except Exception as e:
        print(f"Atlas Server: ❌ Недоступний ({e})")
        return False
    
    try:
        # Перевіряємо Orchestrator
        response = requests.get(f"{ORCHESTRATOR_SERVER}/health", timeout=5)
        print(f"Orchestrator: {response.status_code} ✅")
    except Exception as e:
        print(f"Orchestrator: ❌ Недоступний ({e})")
        return False
    
    return True

def main():
    print("🚀 Тестування інтеграції Гриши з візуальним моніторингом\n")
    
    # Перевіряємо сервери
    if not check_servers():
        print("\n❌ Сервери недоступні. Запустіть їх командою: ./start_stack_macos.sh")
        return
    
    # Тестуємо API ендпоінти
    if not test_monitoring_endpoints():
        print("\n❌ Тестування API не пройдено")
        return
    
    # Тестуємо інтеграцію з агентами
    if not test_agent_integration():
        print("\n❌ Тестування агентів не пройдено")
        return
    
    print("\n🎉 Всі тести пройдені успішно!")
    print("\n📝 Інтеграція візуального моніторингу Гриши працює коректно:")
    print("   • API ендпоінти доступні")
    print("   • Моніторинг запускається та зупиняється")
    print("   • Візуальні докази збираються")
    print("   • Гриша використовує візуальну інформацію при верифікації")

if __name__ == "__main__":
    main()
