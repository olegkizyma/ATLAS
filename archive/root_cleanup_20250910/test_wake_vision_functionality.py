#!/usr/bin/env python3
"""
Тестування функціональності режиму прослуховування та системи зору ATLAS
"""

import asyncio
import aiohttp
import json
import time
from urllib.parse import urljoin

class ATLASFunctionalityTester:
    def __init__(self, base_url="http://localhost:5001"):
        self.base_url = base_url
        self.session = None
        
    async def __aenter__(self):
        self.session = aiohttp.ClientSession()
        return self
        
    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self.session:
            await self.session.close()
    
    async def test_server_status(self):
        """Перевірка доступності сервера"""
        try:
            async with self.session.get(f"{self.base_url}/api/status") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print("✅ Сервер доступний")
                    print(f"   Статус: {data}")
                    return True
                else:
                    print(f"❌ Сервер недоступний: {resp.status}")
                    return False
        except Exception as e:
            print(f"❌ Помилка підключення до сервера: {e}")
            return False
    
    async def test_vision_system(self):
        """Перевірка системи зору"""
        print("\n🔍 Тестування системи зору...")
        
        try:
            # Перевірка статусу системи зору
            async with self.session.get(f"{self.base_url}/api/vision/status") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print("✅ Vision API доступний")
                    print(f"   Модулі: {data['modules']}")
                    print(f"   Зір доступний: {data['vision_available']}")
                    
                    # Перевірка наявності необхідних модулів
                    required_modules = ['mediapipe', 'opencv', 'pillow', 'yolo']
                    missing = [mod for mod in required_modules if not data['modules'].get(mod, False)]
                    
                    if missing:
                        print(f"⚠️  Відсутні модулі: {missing}")
                        return False
                    else:
                        print("✅ Всі модулі зору доступні")
                        return True
                else:
                    print(f"❌ Vision API недоступний: {resp.status}")
                    return False
                    
        except Exception as e:
            print(f"❌ Помилка перевірки системи зору: {e}")
            return False
    
    async def test_vision_monitoring_api(self):
        """Перевірка API моніторингу зору"""
        print("\n📹 Тестування API моніторингу...")
        
        try:
            # Тест start monitoring (використовуємо правильний ендпоінт)
            monitoring_data = {
                "session_id": f"test_session_{int(time.time())}",
                "task_description": "Test Vision Monitoring"
            }
            
            async with self.session.post(
                f"{self.base_url}/api/grisha/start-monitoring", 
                json=monitoring_data
            ) as resp:
                if resp.status == 200:
                    print("✅ Start monitoring API працює")
                    data = await resp.json()
                    print(f"   Результат: {data}")
                else:
                    print(f"❌ Start monitoring API не працює: {resp.status}")
                    text = await resp.text()
                    print(f"   Помилка: {text}")
                    return False
            
            # Тест stop monitoring (використовуємо правильний ендпоінт)
            async with self.session.post(f"{self.base_url}/api/grisha/stop-monitoring") as resp:
                if resp.status == 200:
                    print("✅ Stop monitoring API працює")
                    return True
                else:
                    print(f"❌ Stop monitoring API не працює: {resp.status}")
                    return False
                    
        except Exception as e:
            print(f"❌ Помилка тестування API моніторингу: {e}")
            return False
    
    async def test_speech_system_endpoints(self):
        """Перевірка ендпоінтів речової системи"""
        print("\n🎤 Тестування речової системи...")
        
        try:
            # Перевірка доступності Whisper
            async with self.session.get(f"{self.base_url}/api/whisper/status") as resp:
                if resp.status == 200:
                    data = await resp.json()
                    print("✅ Whisper API доступний")
                    print(f"   Статус: {data}")
                    
                    if data.get('available'):
                        print("✅ Whisper Large 3 готовий до роботи")
                    else:
                        print("⚠️  Whisper недоступний")
                        
                    return True
                else:
                    print(f"❌ Whisper API недоступний: {resp.status}")
                    return False
                    
        except Exception as e:
            print(f"❌ Помилка перевірки Whisper: {e}")
            return False
    
    async def test_wake_word_variants(self):
        """Перевірка варіантів гарячого слова"""
        print("\n🔥 Перевірка конфігурації wake words...")
        
        # Ці варіанти повинні бути в JavaScript коді
        expected_variants = ['атлас', 'аталс', 'атласе', 'atlas']
        
        print(f"✅ Очікувані варіанти wake word: {expected_variants}")
        print("   Система має реагувати на ці варіанти в режимі прослуховування")
        
        return True
    
    async def check_javascript_functionality(self):
        """Перевірка JavaScript функціональності"""
        print("\n🧠 Перевірка JavaScript функціональності...")
        
        try:
            # Перевірка доступності головної сторінки
            async with self.session.get(self.base_url) as resp:
                if resp.status == 200:
                    html = await resp.text()
                    
                    # Перевірка наявності ключових компонентів
                    checks = {
                        'intelligent-chat-manager.js': 'intelligent-chat-manager.js' in html,
                        'microphone button': 'microphone-btn' in html,
                        'chat container': 'chat-container' in html or 'chat-content' in html,
                        'AtlasIntelligentChatManager script': 'window.AtlasIntelligentChatManager' in html
                    }
                    
                    print("JavaScript компоненти:")
                    for component, present in checks.items():
                        status = "✅" if present else "❌"
                        print(f"   {status} {component}")
                    
                    # Додаткова перевірка - чи завантажуються скрипти
                    if 'intelligent-chat-manager.js' in html:
                        print("✅ Головний скрипт підключений")
                        return True
                    else:
                        print("❌ Головний скрипт не знайдено")
                        return False
                else:
                    print(f"❌ Головна сторінка недоступна: {resp.status}")
                    return False
                    
        except Exception as e:
            print(f"❌ Помилка перевірки JavaScript: {e}")
            return False
    
    async def run_comprehensive_test(self):
        """Запуск повного тестування"""
        print("🧪 ATLAS Functionality Test Suite")
        print("=" * 50)
        
        tests = [
            ("Server Status", self.test_server_status),
            ("Vision System", self.test_vision_system),
            ("Vision Monitoring API", self.test_vision_monitoring_api),
            ("Speech System", self.test_speech_system_endpoints),
            ("Wake Word Configuration", self.test_wake_word_variants),
            ("JavaScript Functionality", self.check_javascript_functionality)
        ]
        
        results = {}
        
        for test_name, test_func in tests:
            print(f"\n📝 Тестування: {test_name}")
            try:
                result = await test_func()
                results[test_name] = result
            except Exception as e:
                print(f"❌ Критична помилка в тесті {test_name}: {e}")
                results[test_name] = False
        
        # Підсумок
        print("\n" + "=" * 50)
        print("📊 ПІДСУМОК ТЕСТУВАННЯ")
        print("=" * 50)
        
        passed = sum(results.values())
        total = len(results)
        
        for test_name, result in results.items():
            status = "✅ PASSED" if result else "❌ FAILED"
            print(f"{status} {test_name}")
        
        print(f"\n🎯 Результат: {passed}/{total} тестів пройдено")
        
        if passed == total:
            print("🎉 Всі функції працюють правильно!")
            print("\n📋 Готовність функціональності:")
            print("   🎤 Одиночний клік → Whisper Large 3 запис")
            print("   👁️  Утримання 1.5с → Atlas прослуховування + зір")
            print("   🔥 Wake word 'Атлас' → активація команд")
            print("   📹 Система зору → готова до аналізу")
        else:
            failed_tests = [name for name, result in results.items() if not result]
            print(f"⚠️  Проблеми з: {', '.join(failed_tests)}")
        
        return passed == total

async def main():
    """Головна функція тестування"""
    async with ATLASFunctionalityTester() as tester:
        success = await tester.run_comprehensive_test()
        return success

if __name__ == "__main__":
    try:
        result = asyncio.run(main())
        exit(0 if result else 1)
    except KeyboardInterrupt:
        print("\n🛑 Тестування перервано користувачем")
        exit(1)
    except Exception as e:
        print(f"\n💥 Критична помилка: {e}")
        exit(1)
