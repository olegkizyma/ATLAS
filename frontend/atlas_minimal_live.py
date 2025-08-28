#!/usr/bin/env python3
"""
Atlas Minimal Frontend Server - Simplified Version
Мінімалістичний хакерський інтерфейс для Atlas
"""

import json
import logging
import time
import subprocess
import re
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse
import requests
import os

# Налаштування логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

import json
import logging
import time
import subprocess
import threading
import queue
import re
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import urllib.parse
import requests
import os

# Налаштування логування
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class LiveLogStreamer:
    """Клас для стрімінгу живих логів системи"""
    
    def __init__(self):
        self.log_queue = queue.Queue()
        self.is_running = False
        # Читаємо URL з env або fallback на localhost
        self.atlas_core_url = os.getenv("ATLAS_CORE_URL", "http://localhost:3000")  # Goose сервер на порту 3000
        
        # Стан всіх процесів для передачі
        self.system_status = {
            "processes": {},
            "services": {},
            "network": {},
            "resources": {},
            "timestamp": None
        }
        
    def start_streaming(self):
        """Запуск стрімінгу логів"""
        self.is_running = True
        threading.Thread(target=self._system_monitor, daemon=True).start()
        threading.Thread(target=self._atlas_monitor, daemon=True).start()
        print("🟢 Live log streaming started")
        
    def stop_streaming(self):
        """Зупинка стрімінгу"""
        self.is_running = False
        print("🔴 Live log streaming stopped")
        
    def get_logs(self):
        """Отримання нових логів"""
        logs = []
        while not self.log_queue.empty():
            try:
                logs.append(self.log_queue.get_nowait())
            except queue.Empty:
                break
        return logs
    
    def get_system_status(self):
        """Отримання поточного стану системи"""
        return self.system_status.copy()
        
    def update_system_status(self, category, key, value):
        """Оновлення стану системи"""
        self.system_status[category][key] = value
        self.system_status["timestamp"] = datetime.now().isoformat()
        
    def _add_log(self, message, level="info"):
        """Додавання логу до черги"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        
        if self.log_queue.qsize() < 200:  # Обмеження розміру черги
            self.log_queue.put({
                "message": log_entry,
                "level": level,
                "timestamp": timestamp
            })
            
    def _system_monitor(self):
        """Моніторинг системи та збереження стану процесів"""
        while self.is_running:
            try:
                # Процеси Atlas
                result = subprocess.run(
                    ["ps", "aux"], 
                    capture_output=True, 
                    text=True
                )
                
                if result.returncode == 0:
                    lines = result.stdout.split('\n')
                    
                    # Пошук процесів Atlas
                    atlas_processes = []
                    goose_processes = []
                    mcp_processes = []
                    python_processes = []
                    
                    for line in lines:
                        if line.strip() and 'grep' not in line:
                            if 'atlas' in line.lower():
                                atlas_processes.append(self._parse_process_line(line))
                            elif 'goose' in line.lower():
                                goose_processes.append(self._parse_process_line(line))
                            elif 'mcp' in line.lower():
                                mcp_processes.append(self._parse_process_line(line))
                            elif 'python' in line and ('atlas' in line or 'mcp' in line):
                                python_processes.append(self._parse_process_line(line))
                    
                    # Оновлення стану процесів
                    self.update_system_status("processes", "atlas", {
                        "count": len(atlas_processes),
                        "details": atlas_processes
                    })
                    self.update_system_status("processes", "goose", {
                        "count": len(goose_processes), 
                        "details": goose_processes
                    })
                    self.update_system_status("processes", "mcp", {
                        "count": len(mcp_processes),
                        "details": mcp_processes
                    })
                    self.update_system_status("processes", "python", {
                        "count": len(python_processes),
                        "details": python_processes
                    })
                    
                    # Логування
                    total_processes = len(atlas_processes) + len(goose_processes) + len(mcp_processes)
                    if total_processes > 0:
                        self._add_log(f"[SYSTEM] {total_processes} Atlas-related processes active")
                
                # Мережеві підключення  
                try:
                    result = subprocess.run(
                        ["lsof", "-i", ":3000", "-i", ":8080"], 
                        capture_output=True, 
                        text=True
                    )
                    if result.returncode == 0:
                        lines = result.stdout.split('\n')[1:]  # Skip header
                        active_connections = []
                        for line in lines:
                            if line.strip():
                                active_connections.append(self._parse_network_line(line))
                        
                        self.update_system_status("network", "connections", {
                            "count": len(active_connections),
                            "details": active_connections
                        })
                        
                        if active_connections:
                            self._add_log(f"[NET] {len(active_connections)} active connections on Atlas ports")
                except Exception as e:
                    self._add_log(f"[NET] Network check failed: {str(e)[:30]}...", "warning")
                
                # Використання ресурсів
                try:
                    # CPU та Memory
                    result = subprocess.run(
                        ["top", "-l", "1", "-n", "0"], 
                        capture_output=True, 
                        text=True
                    )
                    if result.returncode == 0:
                        cpu_info = self._parse_cpu_info(result.stdout)
                        self.update_system_status("resources", "cpu", cpu_info)
                        
                        # Disk space
                        result = subprocess.run(
                            ["df", "-h", "/"], 
                            capture_output=True, 
                            text=True
                        )
                        if result.returncode == 0:
                            disk_info = self._parse_disk_info(result.stdout)
                            self.update_system_status("resources", "disk", disk_info)
                            
                except Exception as e:
                    self._add_log(f"[RESOURCES] Resource check failed: {str(e)[:30]}...", "warning")
                    
                time.sleep(3)
                
            except Exception as e:
                self._add_log(f"[ERROR] System monitor: {str(e)[:30]}...", "error")
                time.sleep(5)
            
    def _atlas_monitor(self):
        """Моніторинг Atlas Core"""
        while self.is_running:
            try:
                response = requests.get(f"{self.atlas_core_url}/", timeout=3)
                if response.status_code == 200:
                    self._add_log("[ATLAS] Core online")
                    self.update_system_status("services", "atlas_core", {
                        "status": "online",
                        "status_code": 200,
                        "last_check": datetime.now().isoformat()
                    })
                else:
                    self._add_log(f"[ATLAS] Core status: {response.status_code}", "warning")
                    self.update_system_status("services", "atlas_core", {
                        "status": "warning", 
                        "status_code": response.status_code,
                        "last_check": datetime.now().isoformat()
                    })
                    
            except requests.exceptions.ConnectionError:
                self._add_log("[ATLAS] Core offline", "warning")
                self.update_system_status("services", "atlas_core", {
                    "status": "offline",
                    "error": "Connection refused",
                    "last_check": datetime.now().isoformat()
                })
            except Exception as e:
                self._add_log(f"[ATLAS] Error: {str(e)[:40]}...", "error")
                self.update_system_status("services", "atlas_core", {
                    "status": "error",
                    "error": str(e)[:100],
                    "last_check": datetime.now().isoformat()
                })
                
            time.sleep(6)
    
    def _parse_process_line(self, line):
        """Парсинг рядка процесу з ps aux"""
        try:
            parts = line.split()
            if len(parts) >= 11:
                return {
                    "user": parts[0],
                    "pid": parts[1],
                    "cpu": parts[2],
                    "mem": parts[3],
                    "command": " ".join(parts[10:])[:50] + "..." if len(" ".join(parts[10:])) > 50 else " ".join(parts[10:])
                }
        except:
            return {"raw": line[:50] + "..." if len(line) > 50 else line}
        return {}
    
    def _parse_network_line(self, line):
        """Парсинг рядка мережевого підключення з lsof"""
        try:
            parts = line.split()
            if len(parts) >= 9:
                return {
                    "command": parts[0],
                    "pid": parts[1],
                    "user": parts[2],
                    "type": parts[4],
                    "node": parts[7],
                    "name": parts[8] if len(parts) > 8 else ""
                }
        except:
            return {"raw": line[:50] + "..." if len(line) > 50 else line}
        return {}
    
    def _parse_cpu_info(self, top_output):
        """Парсинг інформації про CPU з top"""
        try:
            lines = top_output.split('\n')
            for line in lines:
                if 'CPU usage' in line:
                    # Приклад: CPU usage: 12.34% user, 5.67% sys, 82.01% idle
                    parts = line.split(':')[1] if ':' in line else line
                    return {"usage_line": parts.strip()[:100]}
            return {"usage_line": "CPU info not found"}
        except:
            return {"usage_line": "CPU parsing failed"}
    
    def _parse_disk_info(self, df_output):
        """Парсинг інформації про диск з df"""
        try:
            lines = df_output.split('\n')
            if len(lines) > 1:
                parts = lines[1].split()
                if len(parts) >= 5:
                    return {
                        "filesystem": parts[0],
                        "size": parts[1],
                        "used": parts[2],
                        "available": parts[3],
                        "usage_percent": parts[4]
                    }
            return {"info": "Disk parsing failed"}
        except:
            return {"info": "Disk info unavailable"}

class AtlasMinimalHandler(SimpleHTTPRequestHandler):
    """Спрощений HTTP обробник для Atlas"""
    
    def __init__(self, *args, **kwargs):
        self.atlas_core_url = "http://localhost:3000"
        super().__init__(*args, **kwargs)

    @classmethod
    def set_live_streamer(cls, streamer):
        cls.live_streamer = streamer

    def end_headers(self):
        """Додаємо CORS заголовки до всіх відповідей"""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

    def do_OPTIONS(self):
        """Обробка preflight CORS запитів"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        """Обробка GET запитів"""
        if self.path == "/" or self.path == "/index.html":
            self.serve_frontend()
        elif self.path == "/DamagedHelmet.glb":
            self.serve_3d_model()
        elif self.path == "/favicon.ico":
            self.serve_favicon()
        elif self.path.startswith("/logs"):
            self.serve_live_logs()
        elif self.path == "/api/status":
            self.serve_system_status()
        else:
            super().do_GET()

    def do_POST(self):
        """Обробка POST запитів"""
        if self.path == "/api/chat":
            self.handle_chat()
        else:
            self.send_error(404, "Not Found")

    def do_POST(self):
        """Обробка POST запитів"""
        if self.path == "/api/chat":
            self.handle_chat()
        elif self.path == "/api/tts/speak":
            self.handle_tts()
        else:
            self.send_error(404, "Not Found")

    def serve_frontend(self):
        """Головна сторінка"""
        try:
            html_path = Path(__file__).parent / "index.html"
            with open(html_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            self.send_response(200)
            self.send_header('Content-type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(content.encode('utf-8'))))
            self.end_headers()
            self.wfile.write(content.encode('utf-8'))
        except Exception as e:
            logger.error(f"Error serving frontend: {e}")
            self.send_error(500, str(e))

    def serve_3d_model(self):
        """3D модель шолома"""
        try:
            model_path = Path(__file__).parent / "DamagedHelmet.glb"
            if model_path.exists():
                # Отримуємо розмір файлу
                file_size = model_path.stat().st_size
                
                self.send_response(200)
                self.send_header('Content-type', 'application/octet-stream')
                self.send_header('Content-Length', str(file_size))
                self.send_header('Accept-Ranges', 'bytes')
                self.end_headers()
                
                # Відправляємо файл частинами, щоб уникнути переповнення пам'яті
                with open(model_path, 'rb') as f:
                    while True:
                        chunk = f.read(8192)  # 8KB за раз
                        if not chunk:
                            break
                        try:
                            self.wfile.write(chunk)
                            self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError):
                            # Клієнт розірвав з'єднання
                            break
            else:
                self.send_error(404, "3D model not found")
        except Exception as e:
            logger.error(f"Error serving 3D model: {e}")
            try:
                self.send_error(500, str(e))
            except:
                # Якщо не можемо відправити помилку, просто ігноруємо
                pass

    def serve_favicon(self):
        """Іконка сайту"""
        try:
            favicon_path = Path(__file__).parent / "favicon.ico"
            if favicon_path.exists():
                # Отримуємо розмір файлу
                file_size = favicon_path.stat().st_size
                
                self.send_response(200)
                self.send_header('Content-type', 'image/x-icon')
                self.send_header('Content-Length', str(file_size))
                self.end_headers()
                
                # Відправляємо файл частинами
                with open(favicon_path, 'rb') as f:
                    while True:
                        chunk = f.read(1024)  # 1KB за раз
                        if not chunk:
                            break
                        try:
                            self.wfile.write(chunk)
                            self.wfile.flush()
                        except (BrokenPipeError, ConnectionResetError):
                            # Клієнт розірвав з'єднання
                            break
            else:
                # Якщо favicon.ico не існує, повертаємо порожній 1x1 піксель
                self.send_response(200)
                self.send_header('Content-type', 'image/x-icon')
                self.send_header('Content-Length', '0')
                self.end_headers()
        except Exception as e:
            logger.error(f"Error serving favicon: {e}")
            try:
                self.send_error(500, str(e))
            except:
                # Якщо не можемо відправити помилку, просто ігноруємо
                pass

    def serve_health(self):
        """Перевірка стану сервісів"""
        try:
            services = {
                "atlas_minimal": True,
                "atlas_core": "unknown",  # Тимчасово не перевіряємо
                "live_logs": self.live_streamer is not None,
                "timestamp": datetime.now().isoformat()
            }
            
            response = json.dumps(services).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        except Exception as e:
            logger.error(f"Health check error: {e}")
            self.send_error(500, str(e))

    def serve_live_logs(self):
        """Отримання логів (спрощена версія)"""
        try:
            # Парсимо query параметри
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            
            # Отримуємо limit параметр (за замовчуванням 10)
            limit = int(query_params.get('limit', ['10'])[0])
            
            # Повертаємо простий список логів
            logs = []
            for i in range(min(limit, 10)):
                logs.append({
                    "message": f"[{datetime.now().strftime('%H:%M:%S')}] System log {i+1}",
                    "level": "info",
                    "timestamp": datetime.now().strftime("%H:%M:%S")
                })
            
            response = json.dumps({"logs": logs}).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        except Exception as e:
            logger.error(f"Live logs error: {e}")
            try:
                self.send_error(500, str(e))
            except:
                pass

    def serve_log_stream(self):
        """Server-Sent Events стрім логів"""
        try:
            # Встановлюємо заголовки для SSE
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            
            # Відправляємо повідомлення про статус підключення
            status_data = {
                "timestamp": datetime.now().isoformat(),
                "level": "INFO", 
                "source": "atlas_frontend",
                "message": "Log stream connected successfully"
            }
            self.wfile.write(f"data: {json.dumps(status_data)}\n\n".encode())
            
            # Читаємо останні логи з /tmp/goose.log (якщо є)
            try:
                if Path("/tmp/goose.log").exists():
                    with open("/tmp/goose.log", 'r') as f:
                        lines = f.readlines()
                        for line in lines[-10:]:  # Останні 10 рядків
                            if line.strip():
                                # Парсимо лог лінію (видаляє дати та залишає тільки рівень + повідомлення)
                                parsed_line = self._parse_log_line(line.strip())
                                # Пропускаємо None значення (наприклад, рядки "at crates/...")
                                if parsed_line is not None:
                                    event_data = {
                                        "timestamp": datetime.now().isoformat(),
                                        "level": "DEBUG",  # Тьмяніший рівень
                                        "source": "goose",
                                        "message": parsed_line
                                    }
                                    self.wfile.write(f"data: {json.dumps(event_data)}\n\n".encode())
                                    self.wfile.flush()  # Примусово відправляємо дані
            except Exception as e:
                logger.error(f"Error reading goose logs: {e}")
            
            # Відправляємо кінцеве повідомлення
            end_data = {
                "timestamp": datetime.now().isoformat(),
                "level": "INFO",
                "source": "atlas_frontend", 
                "message": "Initial log data sent"
            }
            self.wfile.write(f"data: {json.dumps(end_data)}\n\n".encode())
            self.wfile.flush()
            
        except Exception as e:
            logger.error(f"Log stream error: {e}")
            # Не викликаємо send_error після send_response
            return

    def serve_system_status(self):
        """Отримання стану системи (спрощена версія)"""
        try:
            status = {
                "services": {
                    "atlas_frontend": "running",
                    "timestamp": datetime.now().isoformat()
                },
                "processes": {
                    "atlas": {"count": 1, "status": "active"}
                }
            }
            
            response = json.dumps(status).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        except Exception as e:
            logger.error(f"System status error: {e}")
            try:
                self.send_error(500, str(e))
            except:
                pass
            self.end_headers()
            self.wfile.write(response)
        except Exception as e:
            logger.error(f"System status error: {e}")
            self.send_error(500, str(e))

    def handle_chat(self):
        """Обробка чат запитів до Goose API (спрощена версія)"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            # Підтримка як "message" так і "prompt"
            prompt = data.get("message", data.get("prompt", ""))
            if not prompt:
                self.send_json_response({"error": "Message is required"}, 400)
                return
            
            # Виклик Goose CLI з правильною командою
            try:
                import subprocess
                import os
                
                # Використовуємо робочу команду Goose
                goose_path = "/Users/dev/Documents/GitHub/ATLAS/goose/target/release/goose"
                cmd = [
                    goose_path, "run", 
                    "-t", prompt,
                    "--quiet"
                ]
                
                # Запускаємо Goose з текстом
                result = subprocess.run(
                    cmd,
                    capture_output=True, 
                    text=True, 
                    timeout=600,  # Збільшуємо таймаут до 5 хвилин
                    cwd="/Users/dev/Documents/GitHub/ATLAS/goose",
                    env={
                        **os.environ, 
                        "PATH": "/Users/dev/Documents/GitHub/ATLAS/goose/bin:" + os.environ.get("PATH", ""),
                        "RUST_LOG": "info"
                    }
                )
                
                if result.returncode == 0:
                    answer = result.stdout.strip()
                    if not answer:
                        answer = "Goose відповів, але відповідь порожня"
                    
                    self.send_json_response({"response": answer})
                else:
                    error_msg = result.stderr.strip() or "Goose command failed"
                    self.send_json_response({"response": f"⚠️ Помилка: {error_msg}"})
                    
            except subprocess.TimeoutExpired:
                self.send_json_response({"response": "⚠️ Час очікування відповіді закінчився"})
            except Exception as e:
                self.send_json_response({"response": f"⚠️ Помилка виконання: {str(e)}"})
                
        except Exception as e:
            logger.error(f"Chat error: {e}")
            self.send_json_response({"error": str(e)}, 500)
    
    def send_json_response(self, data, status_code=200):
        """Відправка JSON відповіді"""
        try:
            response = json.dumps(data, ensure_ascii=False).encode('utf-8')
            self.send_response(status_code)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
        except Exception as e:
            logger.error(f"Error sending JSON response: {e}")

    def _format_status_for_ai(self, status):
        """Форматування стану системи для передачі AI"""
        try:
            lines = []
            
            # Процеси
            if status.get("processes"):
                total_proc = sum(p.get("count", 0) for p in status["processes"].values())
                lines.append(f"Processes: {total_proc} Atlas-related running")
                
                for proc_type, proc_info in status["processes"].items():
                    if proc_info.get("count", 0) > 0:
                        lines.append(f"  - {proc_type}: {proc_info['count']} active")
            
            # Сервіси
            if status.get("services"):
                lines.append("Services:")
                for service, service_info in status["services"].items():
                    service_status = service_info.get("status", "unknown")
                    lines.append(f"  - {service}: {service_status}")
            
            # Мережа
            if status.get("network", {}).get("connections"):
                conn_count = status["network"]["connections"].get("count", 0)
                lines.append(f"Network: {conn_count} active connections")
            
            # Ресурси
            if status.get("resources"):
                if status["resources"].get("cpu"):
                    cpu_info = status["resources"]["cpu"].get("usage_line", "")
                    if cpu_info:
                        lines.append(f"CPU: {cpu_info}")
                        
                if status["resources"].get("disk"):
                    disk_info = status["resources"]["disk"]
                    if disk_info.get("usage_percent"):
                        lines.append(f"Disk: {disk_info['usage_percent']} used")
            
            return "\n".join(lines) if lines else "System status unavailable"
            
        except Exception as e:
            return f"Status formatting error: {str(e)}"

    def handle_tts(self):
        """Обробка TTS запитів"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            text = data.get("text", "")
            if not text:
                self.send_json_response({"error": "Text is required"}, 400)
                return
            
            if self.live_streamer:
                self.live_streamer._add_log(f"[TTS] Request: {text[:30]}...")
            
            success = self.send_tts_request(text)
            if success:
                self.send_json_response({"status": "success"})
            else:
                self.send_json_response({"error": "TTS service unavailable"}, 503)
                
        except Exception as e:
            logger.error(f"TTS error: {e}")
            self.send_json_response({"error": str(e)}, 500)

    def send_json_response(self, data, status_code=200):
        """Відправка JSON відповіді"""
        response = json.dumps(data).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def send_to_atlas_core(self, message):
        """Відправлення повідомлення до Atlas Core"""
        try:
            response = requests.post(
                f"{self.atlas_core_url}/chat",
                json={"message": message},
                timeout=60  # Збільшуємо таймаут до 1 хвилини
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("response", data.get("message"))
        except Exception as e:
            logger.debug(f"Atlas Core request failed: {e}")
        return None

    def send_tts_request(self, text):
        """TTS запит безпосередньо до MCP серверу"""
        try:
            response = requests.post(
                "http://localhost:3001/tts",
                json={"text": text, "language": "uk"},
                timeout=10
            )
            return response.status_code == 200
        except Exception as e:
            logger.debug(f"TTS request failed: {e}")
        return False

    def send_tts_to_atlas(self, text):
        """Відправка TTS запиту до Atlas Core"""
        try:
            if self.live_streamer:
                self.live_streamer._add_log(f"[TTS] Speaking: {text[:20]}...")
            
            # Atlas Core має /tts endpoint
            response = requests.post(
                f"{self.atlas_core_url}/tts",
                json={"text": text, "rate": 200},
                timeout=10
            )
            
            if response.status_code == 200:
                if self.live_streamer:
                    self.live_streamer._add_log("[TTS] Success", "info")
                return True
            else:
                if self.live_streamer:
                    self.live_streamer._add_log(f"[TTS] Error {response.status_code}", "warning")
                return False
                
        except Exception as e:
            if self.live_streamer:
                self.live_streamer._add_log(f"[TTS] Failed: {str(e)[:30]}", "error")
            logger.debug(f"TTS to Atlas failed: {e}")
        return False

    def check_service(self, url):
        """Перевірка доступності сервісу"""
        try:
            if url.endswith(':3000'):
                # Goose сервер має /status ендпоінт
                response = requests.get(f"{url}/status", timeout=2)
            elif url.endswith(':8000'):
                # Atlas Core використовує головну сторінку замість /health
                response = requests.get(url, timeout=2)
            else:
                # Для інших сервісів використовуємо /health
                response = requests.get(f"{url}/health", timeout=2)
            return response.status_code < 500
        except Exception as e:
            logger.debug(f"Service check failed for {url}: {e}")
            return False

def main():
    """Запуск сервера (спрощена версія)"""
    port = 8080
    server_address = ('', port)
    
    # Зміна робочої директорії
    os.chdir(Path(__file__).parent)
    
    httpd = HTTPServer(server_address, AtlasMinimalHandler)
    
    print("🚀 Starting Atlas Minimal Frontend Server...")
    print(f"📱 Interface: http://localhost:{port}")
    print("💾 3D Viewer: Background layer")
    print("📋 MCP Logs: Left panel")
    print("💬 Chat: Right panel")
    print(f"🎯 Server running on port {port}")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopping...")
        httpd.shutdown()
        print("🛑 Server stopped")

if __name__ == "__main__":
    main()
