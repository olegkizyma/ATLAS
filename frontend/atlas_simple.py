#!/usr/bin/env python3
"""
ATLAS Minimal Live Interface with Goose Integration
"""

import os
import json
import logging
import subprocess
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler

# Логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AtlasHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        """Обробка GET запитів"""
        if self.path == "/" or self.path == "/index.html":
            self.serve_file("index.html")
        elif self.path == "/DamagedHelmet.glb":
            self.serve_file("DamagedHelmet.glb")
        elif self.path == "/api/status":
            self.serve_status()
        elif self.path.startswith("/logs"):
            self.serve_logs()
        else:
            super().do_GET()
    
    def do_POST(self):
        """Обробка POST запитів"""
        if self.path == "/api/chat":
            self.handle_chat()
        else:
            self.send_error(404, "Not Found")
    
    def serve_file(self, filename):
        """Подача статичних файлів"""
        try:
            file_path = Path(__file__).parent / filename
            with open(file_path, 'rb') as f:
                content = f.read()
            
            if filename.endswith('.html'):
                content_type = 'text/html; charset=utf-8'
            elif filename.endswith('.glb'):
                content_type = 'model/gltf-binary'
            else:
                content_type = 'application/octet-stream'
            
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', len(content))
            self.end_headers()
            self.wfile.write(content)
            
        except FileNotFoundError:
            self.send_error(404, f"File {filename} not found")
        except Exception as e:
            logger.error(f"Error serving {filename}: {e}")
            self.send_error(500, str(e))
    
    def serve_status(self):
        """API статусу з Goose метриками"""
        try:
            # Goose метрики
            goose_data = self.get_goose_data()
            
            # Системні ресурси
            system_data = self.get_system_data()
            
            status = {
                "goose": goose_data,
                "system": system_data,
                "timestamp": datetime.now().isoformat()
            }
            
            response = json.dumps(status, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            logger.error(f"Status error: {e}")
            self.send_error(500, str(e))
    
    def get_goose_data(self):
        """Отримання Goose метрик"""
        try:
            # Кількість сесій
            sessions_dir = "/Users/dev/.local/share/goose/sessions"
            session_count = 0
            session_size = 0
            recent_sessions = []
            
            if Path(sessions_dir).exists():
                session_files = list(Path(sessions_dir).glob("*.jsonl"))
                session_count = len(session_files)
                session_size = sum(f.stat().st_size for f in session_files if f.exists())
                
                # 3 останні сесії
                recent_files = sorted(session_files, key=lambda f: f.stat().st_mtime, reverse=True)[:3]
                for f in recent_files:
                    recent_sessions.append({
                        "id": f.stem,
                        "size_kb": round(f.stat().st_size / 1024, 1),
                        "modified": datetime.fromtimestamp(f.stat().st_mtime).strftime("%H:%M")
                    })
            
            # Кількість логів
            logs_dir = "/Users/dev/.local/state/goose/logs"
            log_count = 0
            log_size = 0
            
            if Path(logs_dir).exists():
                for root, dirs, files in os.walk(logs_dir):
                    log_count += len(files)
                    for file in files:
                        file_path = Path(root) / file
                        if file_path.exists():
                            log_size += file_path.stat().st_size
            
            return {
                "version": "1.6.0",
                "sessions": {
                    "count": session_count,
                    "size_mb": round(session_size / (1024 * 1024), 2),
                    "recent": recent_sessions
                },
                "logs": {
                    "count": log_count,
                    "size_mb": round(log_size / (1024 * 1024), 2)
                }
            }
            
        except Exception as e:
            logger.error(f"Goose data error: {e}")
            return {"error": str(e)}
    
    def get_system_data(self):
        """Системні метрики"""
        try:
            # CPU
            result = subprocess.run(["top", "-l", "1", "-n", "0"], capture_output=True, text=True, timeout=5)
            cpu_line = "Unknown"
            if result.returncode == 0:
                for line in result.stdout.split('\n'):
                    if 'CPU usage' in line:
                        cpu_line = line.strip()
                        break
            
            # Диск
            result = subprocess.run(["df", "-h", "/"], capture_output=True, text=True, timeout=3)
            disk_info = "Unknown"
            if result.returncode == 0:
                lines = result.stdout.split('\n')
                if len(lines) > 1:
                    parts = lines[1].split()
                    if len(parts) >= 5:
                        disk_info = f"{parts[2]} / {parts[1]} ({parts[4]})"
            
            return {
                "cpu": cpu_line,
                "disk": disk_info
            }
            
        except Exception as e:
            return {"error": str(e)}
    
    def serve_logs(self):
        """Подача логів"""
        try:
            logs = [
                {"timestamp": datetime.now().isoformat(), "level": "INFO", "message": "🚀 ATLAS System Online"},
                {"timestamp": datetime.now().isoformat(), "level": "INFO", "message": "📊 Goose Integration Active"}
            ]
            
            response = json.dumps(logs).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            logger.error(f"Logs error: {e}")
            self.send_error(500, str(e))
    
    def handle_chat(self):
        """Обробка чат повідомлень"""
        try:
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            message = data.get('message') or data.get('prompt', '')
            
            if not message:
                self.send_error(400, "No message provided")
                return
            
            # Відповідь
            response_data = {"response": f"🤖 Отримано: {message}"}
            response = json.dumps(response_data).encode('utf-8')
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', len(response))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            logger.error(f"Chat error: {e}")
            self.send_error(500, str(e))


def main():
    """Запуск сервера"""
    port = 8080
    
    print("🟢 Starting ATLAS Minimal Interface...")
    print(f"🚀 Server will run on http://localhost:{port}")
    
    try:
        server = HTTPServer(('localhost', port), AtlasHandler)
        print(f"✅ Server started successfully!")
        print(f"🌐 Open http://localhost:{port} in your browser")
        server.serve_forever()
    except KeyboardInterrupt:
        print("🛑 Server stopped by user")
    except Exception as e:
        print(f"❌ Server error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
