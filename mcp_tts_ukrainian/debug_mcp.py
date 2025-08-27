#!/usr/bin/env python3
"""
Отладка MCP сервера
"""

import json
import subprocess
import time
import os

def debug_mcp_server():
    """Дебаг MCP сервера"""
    print("🔧 Debugging MCP Server...")
    
    os.chdir("/Users/dev/Documents/Atlas-mcp/mcp_tts_ukrainian")
    
    try:
        process = subprocess.Popen(
            ["bash", "start_fixed.sh"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        
        # Чекаємо готовність
        time.sleep(3)
        
        # Читаємо stderr для початкових повідомлень
        stderr_output = ""
        try:
            stderr_output = process.stderr.read()
            print("STDERR OUTPUT:")
            print(stderr_output)
        except:
            pass
        
        # Надсилаємо initialize
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "debug-client", "version": "1.0.0"}
            }
        }
        
        request_line = json.dumps(init_request) + "\n"
        print("SENDING REQUEST:")
        print(request_line)
        
        process.stdin.write(request_line)
        process.stdin.flush()
        
        # Чекаємо відповідь
        time.sleep(2)
        
        # Читаємо stdout
        stdout_lines = []
        try:
            while True:
                line = process.stdout.readline()
                if not line:
                    break
                stdout_lines.append(line.strip())
                if len(stdout_lines) > 10:  # Обмежуємо кількість ліній
                    break
        except:
            pass
        
        print("STDOUT LINES:")
        for i, line in enumerate(stdout_lines):
            print(f"Line {i}: {repr(line)}")
        
        # Перевіряємо статус процесу
        poll_result = process.poll()
        print(f"Process status: {poll_result}")
        
        # Завершуємо процес
        process.terminate()
        try:
            process.wait(timeout=5)
        except:
            process.kill()
        
    except Exception as e:
        print(f"Debug failed: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    debug_mcp_server()
