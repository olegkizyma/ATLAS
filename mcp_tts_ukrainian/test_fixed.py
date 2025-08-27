#!/usr/bin/env python3
"""
Тест для виправленого Ukrainian TTS MCP сервера
"""

import json
import subprocess
import sys
import time

def test_mcp_server():
    """Тестування MCP сервера"""
    print("🧪 Тестування виправленого Ukrainian TTS MCP сервера...")
    
    try:
        # Запуск сервера
        process = subprocess.Popen(
            ['bash', 'start_fixed.sh'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=0
        )
        
        # Тест 1: Initialize
        print("📡 Тест 1: Initialize...")
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "1.0"}
            }
        }
        
        process.stdin.write(json.dumps(init_request) + '\n')
        process.stdin.flush()
        
        response_line = process.stdout.readline()
        if response_line:
            response = json.loads(response_line.strip())
            print(f"✅ Initialize OK: {response.get('result', {}).get('serverInfo', {}).get('name')}")
        
        # Тест 2: Tools list
        print("🔧 Тест 2: Tools list...")
        tools_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        }
        
        process.stdin.write(json.dumps(tools_request) + '\n')
        process.stdin.flush()
        
        response_line = process.stdout.readline()
        if response_line:
            response = json.loads(response_line.strip())
            tools = response.get('result', {}).get('tools', [])
            print(f"✅ Tools available: {[tool['name'] for tool in tools]}")
        
        # Тест 3: TTS call (short text)
        print("🎵 Тест 3: Ukrainian TTS...")
        tts_request = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "ukrainian_tts",
                "arguments": {
                    "text": "Тест",
                    "lang": "uk",
                    "voice": "mykyta"
                }
            }
        }
        
        process.stdin.write(json.dumps(tts_request) + '\n')
        process.stdin.flush()
        
        # Чекаємо відповідь з таймаутом
        start_time = time.time()
        while time.time() - start_time < 15:  # 15 секунд таймаут
            if process.stdout.readable():
                response_line = process.stdout.readline()
                if response_line:
                    response = json.loads(response_line.strip())
                    result = response.get('result', {})
                    if result:
                        content = result.get('content', [{}])[0].get('text', '{}')
                        tts_result = json.loads(content)
                        if tts_result.get('success'):
                            print(f"✅ TTS OK: engine={tts_result.get('engine')}")
                        else:
                            print(f"❌ TTS Failed: {tts_result.get('error')}")
                    break
            time.sleep(0.1)
        else:
            print("⏰ TTS таймаут")
        
        # Завершення
        process.terminate()
        process.wait(timeout=5)
        print("🎉 Тестування завершено!")
        
    except Exception as e:
        print(f"❌ Помилка тесту: {e}")
        if 'process' in locals():
            process.terminate()

if __name__ == "__main__":
    test_mcp_server()
