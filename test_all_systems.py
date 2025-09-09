#!/usr/bin/env python3
"""
Комплексний тест всіх систем ATLAS з dummy-key
"""

import requests
import json
import time
import sys

def test_recovery_bridge():
    """Тестує Recovery Bridge WebSocket сервер"""
    try:
        # Для WebSocket сервера перевіряємо чи він відповідає 426 Upgrade Required
        response = requests.get("http://localhost:5102", timeout=5)
        if response.status_code == 426:
            print("✅ Recovery Bridge (WebSocket): ПРАЦЮЄ")
            return True
        else:
            print(f"❌ Recovery Bridge: Unexpected response {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Recovery Bridge: {str(e)[:50]}...")
        return False

def test_service(name, url, timeout=10):
    """Тестує доступність сервісу"""
    try:
        response = requests.get(url, timeout=timeout)
        if response.status_code == 200:
            print(f"✅ {name}: ПРАЦЮЄ")
            return True
        else:
            print(f"❌ {name}: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ {name}: {str(e)[:50]}...")
        return False

def test_orchestrator_model(agent, message="Test dummy-key"):
    """Тестує агента через orchestrator API"""
    try:
        payload = {
            "agent": agent,
            "message": message,
            "maxTokens": 50
        }
        response = requests.post(
            "http://localhost:5101/test/model_rotation",
            headers={"Content-Type": "application/json"},
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            data = response.json()
            model = data.get('response', {}).get('model', 'unknown')
            content = data.get('response', {}).get('content', '')[:50]
            print(f"✅ {agent.upper()}: {model} -> {content}...")
            return True
        else:
            print(f"❌ {agent.upper()}: HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ {agent.upper()}: {str(e)[:50]}...")
        return False

def main():
    print("🧪 КОМПЛЕКСНИЙ ТЕСТ ATLAS СИСТЕМ З DUMMY-KEY")
    print("=" * 60)
    
    # Тест базових сервісів
    print("\n📊 ТЕСТ БАЗОВИХ СЕРВІСІВ:")
    services = [
        ("Frontend", "http://localhost:5001/api/health"),
        ("Orchestrator", "http://localhost:5101/health"),
        ("GitHub Models Proxy", "http://localhost:3010/v1/models"),
        ("TTS Server", "http://localhost:3001/health"),
    ]
    
    service_results = []
    for name, url in services:
        result = test_service(name, url)
        service_results.append(result)
    
    # Тест Recovery Bridge окремо (WebSocket)
    print("\n🔗 ТЕСТ RECOVERY BRIDGE (WebSocket):")
    bridge_result = test_recovery_bridge()
    service_results.append(bridge_result)
    
    # Тест агентів через orchestrator
    print("\n🤖 ТЕСТ АГЕНТІВ ЧЕРЕЗ ORCHESTRATOR (з dummy-key):")
    agents = ["atlas", "tetyana", "grisha"]
    agent_results = []
    
    for agent in agents:
        result = test_orchestrator_model(agent, f"Test dummy-key for {agent}")
        agent_results.append(result)
        time.sleep(1)  # Пауза між запитами
    
    # Тест client-module прямо
    print("\n📦 ТЕСТ CLIENT-MODULE (прямо з dummy-key):")
    try:
        import sys
        import os
        sys.path.append('/Users/dev/Documents/GitHub/ATLAS/client-module/python_client')
        from client import GitHubModelsClient
        
        client = GitHubModelsClient(api_key='dummy-key')
        result = client.chat_completion(
            model='openai/gpt-4o-mini',
            messages=[{'role': 'user', 'content': 'Test client-module dummy-key'}],
            max_tokens=50
        )
        
        if result['success']:
            print(f"✅ CLIENT-MODULE: {result['model']} -> {result['content'][:50]}...")
            client_result = True
        else:
            print(f"❌ CLIENT-MODULE: {result['error']}")
            client_result = False
    except Exception as e:
        print(f"❌ CLIENT-MODULE: {str(e)[:50]}...")
        client_result = False
    
    # Підсумок
    print("\n📋 ПІДСУМОК ТЕСТУВАННЯ:")
    print(f"🔧 Сервіси + WebSocket: {sum(service_results)}/{len(service_results)}")
    print(f"🤖 Агенти (orchestrator): {sum(agent_results)}/{len(agent_results)}")
    print(f"📦 Client-module: {'✅' if client_result else '❌'}")
    
    total_success = sum(service_results) + sum(agent_results) + int(client_result)
    total_tests = len(service_results) + len(agent_results) + 1
    
    print(f"\n🎯 ЗАГАЛЬНИЙ РЕЗУЛЬТАТ: {total_success}/{total_tests}")
    
    if total_success == total_tests:
        print("🎉 ВСІ СИСТЕМИ ПРАЦЮЮТЬ З DUMMY-KEY!")
        return 0
    else:
        print("⚠️ ДЕЯКІ СИСТЕМИ МАЮТЬ ПРОБЛЕМИ")
        return 1

if __name__ == "__main__":
    sys.exit(main())
