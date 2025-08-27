#!/usr/bin/env python3
"""
Тест goose Ukrainian TTS MCP сервера
"""
import subprocess
import json
import time

def test_goose_mcp():
    """Тестування Ukrainian TTS через goose MCP"""
    print("🧪 Testing Ukrainian TTS through Goose MCP...")
    
    # Запуск MCP сервера
    cmd = ['bash', '-c', 'cd goose && source bin/activate-hermit && cargo run --bin mcp-tts-ukrainian']
    
    process = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )
    
    try:
        # Ініціалізація
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
        
        print("📤 Sending initialize...")
        process.stdin.write(json.dumps(init_msg) + '\n')
        process.stdin.flush()
        
        # Читання відповіді
        response = process.stdout.readline()
        print(f"📥 Init response: {response.strip()}")
        
        # TTS тест
        tts_msg = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/call",
            "params": {
                "name": "say_tts",
                "arguments": {
                    "text": "Привіт! Це тест через goose MCP!",
                    "voice": "tetiana",
                    "lang": "uk"
                }
            }
        }
        
        print("📤 Sending TTS request...")
        process.stdin.write(json.dumps(tts_msg) + '\n')
        process.stdin.flush()
        
        # Читання TTS відповіді
        response = process.stdout.readline()
        print(f"📥 TTS response: {response.strip()}")
        
        print("✅ Test completed!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        
    finally:
        process.terminate()
        time.sleep(1)
        if process.poll() is None:
            process.kill()

if __name__ == "__main__":
    test_goose_mcp()
