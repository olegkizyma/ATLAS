#!/usr/bin/env python3
"""
Тест Rust Ukrainian TTS MCP сервера
"""
import asyncio
import json
import subprocess
import sys

async def test_rust_tts():
    """Тестування Rust TTS сервера через MCP протокол"""
    print("🧪 Testing Rust Ukrainian TTS MCP Server...")
    
    # MCP ініціалізація
    init_msg = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-10-07",
            "capabilities": {},
            "clientInfo": {
                "name": "test-client",
                "version": "1.0.0"
            }
        }
    }
    
    # Виклик TTS
    tts_msg = {
        "jsonrpc": "2.0",
        "id": 2,
        "method": "tools/call",
        "params": {
            "name": "say_tts",
            "arguments": {
                "text": "Привіт! Це тест через Rust MCP сервер з голосом Тетяни!",
                "voice": "tetiana",
                "lang": "uk"
            }
        }
    }
    
    # Запуск сервера
    process = subprocess.Popen(
        ['./target/release/mcp-tts-ukrainian'],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    try:
        # Відправляємо ініціалізацію
        init_json = json.dumps(init_msg) + '\n'
        print(f"📤 Sending: {init_json.strip()}")
        
        process.stdin.write(init_json)
        process.stdin.flush()
        
        # Читаємо відповідь
        response = process.stdout.readline()
        print(f"📥 Response: {response.strip()}")
        
        # Відправляємо TTS запит
        tts_json = json.dumps(tts_msg) + '\n'
        print(f"📤 Sending: {tts_json.strip()}")
        
        process.stdin.write(tts_json)
        process.stdin.flush()
        
        # Читаємо відповідь TTS
        response = process.stdout.readline()
        print(f"📥 TTS Response: {response.strip()}")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        
    finally:
        process.terminate()
        process.wait()

if __name__ == "__main__":
    asyncio.run(test_rust_tts())
