#!/usr/bin/env python3
"""
Тестовий MCP клієнт для Ukrainian TTS
===================================

Простий клієнт для тестування MCP сервера українського TTS
"""

import asyncio
import json
import subprocess
import sys
import time

async def test_mcp_server():
    """Тестування MCP сервера"""
    print("🧪 Starting MCP Client Test...")
    
    # Запуск MCP сервера
    server_process = subprocess.Popen(
        [sys.executable, "mcp_tts_server.py"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        cwd="/Users/dev/Documents/Atlas-mcp/mcp_tts_ukrainian"
    )
    
    def send_request(method, params=None):
        """Відправка MCP запиту"""
        request = {
            "jsonrpc": "2.0",
            "id": int(time.time() * 1000),
            "method": method
        }
        if params:
            request["params"] = params
        
        request_json = json.dumps(request, ensure_ascii=False)
        print(f"📤 Sending: {request_json}")
        
        server_process.stdin.write(request_json + "\n")
        server_process.stdin.flush()
        
        response_line = server_process.stdout.readline()
        if response_line:
            response = json.loads(response_line)
            print(f"📥 Response: {json.dumps(response, ensure_ascii=False, indent=2)}")
            return response
        return None
    
    try:
        # Дочекаємося ініціалізації сервера
        await asyncio.sleep(3)
        
        # Тест 1: Список інструментів
        print("\n1️⃣ Testing tools/list...")
        response = send_request("tools/list")
        
        # Тест 2: Статус TTS
        print("\n2️⃣ Testing tts_status...")
        response = send_request("tools/call", {
            "name": "tts_status",
            "arguments": {}
        })
        
        # Тест 3: Список голосів
        print("\n3️⃣ Testing list_voices...")
        response = send_request("tools/call", {
            "name": "list_voices", 
            "arguments": {}
        })
        
        # Тест 4: Українське озвучення
        print("\n4️⃣ Testing Ukrainian TTS...")
        response = send_request("tools/call", {
            "name": "say_tts",
            "arguments": {
                "text": "Привіт! Це тест MCP сервера!",
                "voice": "mykyta",
                "lang": "uk"
            }
        })
        
        # Тест 5: Англійське озвучення (fallback)
        print("\n5️⃣ Testing English fallback...")
        response = send_request("tools/call", {
            "name": "say_tts",
            "arguments": {
                "text": "Hello! This is MCP server test!",
                "lang": "en"
            }
        })
        
        print("\n✅ All tests completed!")
        
    except Exception as e:
        print(f"❌ Test failed: {e}")
    
    finally:
        # Завершення сервера
        server_process.terminate()
        await asyncio.sleep(1)
        if server_process.poll() is None:
            server_process.kill()

if __name__ == "__main__":
    asyncio.run(test_mcp_server())
