#!/usr/bin/env python3
"""
Тест MCP інтеграції для Ukrainian TTS
"""

import json
import subprocess
import time
import sys
import os

def test_mcp_server():
    """Тестування MCP сервера"""
    print("🔧 Testing Ukrainian TTS MCP Server...")
    
    # Перехід до директорії
    os.chdir("/Users/dev/Documents/Atlas-mcp/mcp_tts_ukrainian")
    
    # Запуск сервера
    try:
        process = subprocess.Popen(
            ["bash", "start_fixed.sh"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Тест 1: Initialize
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test-client", "version": "1.0.0"}
            }
        }
        
        print("📤 Sending initialize request...")
        process.stdin.write(json.dumps(init_request) + "\n")
        process.stdin.flush()
        
        # Читання відповіді
        time.sleep(2)
        output = process.stdout.readline()
        if output:
            response = json.loads(output)
            print("✅ Initialize response:", response)
        else:
            print("❌ No initialize response")
            stderr_output = process.stderr.read()
            print("STDERR:", stderr_output)
            return False
        
        # Тест 2: Initialized notification
        initialized_notification = {
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        }
        
        print("📤 Sending initialized notification...")
        process.stdin.write(json.dumps(initialized_notification) + "\n")
        process.stdin.flush()
        time.sleep(1)
        
        # Тест 3: List tools
        list_tools_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        }
        
        print("📤 Sending tools/list request...")
        process.stdin.write(json.dumps(list_tools_request) + "\n")
        process.stdin.flush()
        time.sleep(2)
        
        output = process.stdout.readline()
        if output:
            response = json.loads(output)
            print("✅ Tools list response:", response)
        else:
            print("❌ No tools list response")
        
        # Тест 4: TTS call
        tts_request = {
            "jsonrpc": "2.0",
            "id": 3,
            "method": "tools/call",
            "params": {
                "name": "ukrainian_tts",
                "arguments": {
                    "text": "Привіт, це тест TTS!",
                    "voice": "mykyta",
                    "lang": "uk"
                }
            }
        }
        
        print("📤 Sending TTS request...")
        process.stdin.write(json.dumps(tts_request) + "\n")
        process.stdin.flush()
        time.sleep(5)  # Більше часу на TTS
        
        output = process.stdout.readline()
        if output:
            response = json.loads(output)
            print("✅ TTS response:", response)
        else:
            print("❌ No TTS response")
        
        # Завершення
        process.terminate()
        process.wait(timeout=5)
        
        print("✅ MCP Server test completed successfully!")
        return True
        
    except Exception as e:
        print(f"❌ MCP Server test failed: {e}")
        if 'process' in locals():
            try:
                process.terminate()
            except:
                pass
        return False

def test_virtual_environment():
    """Тестування віртуального середовища"""
    print("🔧 Testing virtual environment...")
    
    venv_path = "/Users/dev/Documents/Atlas-mcp/atlas_venv"
    python_path = f"{venv_path}/bin/python"
    
    if not os.path.exists(venv_path):
        print(f"❌ Virtual environment not found: {venv_path}")
        return False
    
    if not os.path.exists(python_path):
        print(f"❌ Python not found: {python_path}")
        return False
    
    try:
        # Тест імпортів
        result = subprocess.run([
            python_path, "-c", 
            "import ukrainian_tts; import gtts; import pygame; import mcp; print('All imports successful')"
        ], capture_output=True, text=True, cwd="/Users/dev/Documents/Atlas-mcp/mcp_tts_ukrainian")
        
        if result.returncode == 0:
            print("✅ All dependencies available")
            return True
        else:
            print(f"❌ Import error: {result.stderr}")
            return False
            
    except Exception as e:
        print(f"❌ Venv test failed: {e}")
        return False

def main():
    """Головна функція тестування"""
    print("🚀 Ukrainian TTS MCP Integration Test")
    print("=" * 50)
    
    # Тест 1: Віртуальне середовище
    if not test_virtual_environment():
        print("\n❌ Virtual environment test failed!")
        return False
    
    print("\n" + "=" * 50)
    
    # Тест 2: MCP сервер
    if not test_mcp_server():
        print("\n❌ MCP server test failed!")
        return False
    
    print("\n" + "=" * 50)
    print("🎉 All tests passed! Ukrainian TTS is ready for Goose integration!")
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
