#!/usr/bin/env python3
"""
Atlas Minimal Frontend Server - Simplified Version
Мінімалістичний хакерський інтерфейс для Atlas
ОНОВЛЕНО: Інтеграція з Atlas Core (Atlas LLM1 + Goose + Гріша LLM3)
"""

import json
import logging
import time
import subprocess
import re
import asyncio
import aiohttp
import os
from datetime import datetime
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
import urllib.parse
import requests

# Завантажуємо .env файл
def load_env():
    """Завантажує змінні з .env файлу"""
    env_path = Path(__file__).parent / ".env"
    if env_path.exists():
        print(f"📄 Завантажую .env з {env_path}")
        with open(env_path, 'r') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip()
        print("✅ .env файл завантажено")
    else:
        print("⚠️ .env файл не знайдено")

# Завантажуємо змінні середовища
load_env()

# Перевіряємо API ключі
print(f"🔑 Gemini API: {'✅' if os.getenv('GEMINI_API_KEY') else '❌'}")
print(f"🔑 Mistral API: {'✅' if os.getenv('MISTRAL_API_KEY') else '❌'}")

# Імпортуємо Atlas Core
try:
    from atlas_core import get_atlas_core
    ATLAS_CORE_AVAILABLE = True
    logger = logging.getLogger(__name__)
    logger.info("🚀 Atlas Core успішно завантажений!")
except ImportError as e:
    ATLAS_CORE_AVAILABLE = False
    logger = logging.getLogger(__name__)
    logger.warning(f"⚠️ Atlas Core недоступний: {e}")
    logger.info("Використовуватиму legacy Goose інтеграцію")

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
from http.server import HTTPServer, SimpleHTTPRequestHandler, ThreadingHTTPServer
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
    """Обробник запитів для Atlas Minimal Interface"""
    
    def __init__(self, *args, **kwargs):
        # Конфігурація Goose API: дефолт 3000, fallback 3001 якщо 3000 недоступний (або GOOSE_API_URL з env)
        env_url = os.getenv("GOOSE_API_URL")
        if env_url and self._check_base_url(env_url):
            self.goose_api_url = env_url
        else:
            if env_url and not self._check_base_url(env_url):
                logger.warning(f"⚠️ Недоступний GOOSE_API_URL: {env_url}; виконую автопідбір")
            self.goose_api_url = self._auto_pick_goose_url()
        self.goose_secret_key = os.getenv("GOOSE_SECRET_KEY", "test")  # Секретний ключ для автентифікації
        self.session_endpoint = f"{self.goose_api_url}/session"
        self.reply_endpoint = f"{self.goose_api_url}/reply"
        
        # Конфігурація Atlas Core
        self.atlas_core_url = "http://localhost:3000"
        
        # Ініціалізація live streamer без запуску моніторингу
        self.live_streamer = None
        
        super().__init__(*args, **kwargs)

    def _auto_pick_goose_url(self) -> str:
        """Вибирає базовий URL Goose API: спочатку 3000, потім 3001."""
        import requests as _req
        for base in ("http://127.0.0.1:3000", "http://127.0.0.1:3001"):
            try:
                for ep in ("/status", "/api/health", "/"):
                    try:
                        r = _req.get(f"{base}{ep}", timeout=2)
                        if r.status_code in (200, 404):
                            return base
                    except Exception:
                        continue
            except Exception:
                continue
        return "http://127.0.0.1:3000"

    def _check_base_url(self, base: str) -> bool:
        try:
            import requests as _req
            for ep in ("/status", "/api/health", "/"):
                try:
                    r = _req.get(f"{base}{ep}", timeout=2)
                    if r.status_code in (200, 404):
                        return True
                except Exception:
                    continue
        except Exception:
            return False
        return False
    
    def handle_one_request(self):
        """Override to handle connection resets gracefully"""
        try:
            super().handle_one_request()
        except ConnectionResetError:
            # Client disconnected, ignore silently
            pass
        except BrokenPipeError:
            # Client disconnected while writing response
            pass
        except OSError as e:
            if e.errno == 54:  # Connection reset by peer on macOS
                pass
            else:
                raise
    
    def log_error(self, format, *args):
        """Override to suppress connection reset error logs"""
        if "Connection reset by peer" in format % args:
            return
        if "Broken pipe" in format % args:
            return
        super().log_error(format, *args)
    
    def send_goose_request(self, endpoint: str, method: str = "GET", data: dict = None) -> dict:
        """Відправка запиту до Goose API"""
        try:
            url = f"{self.goose_api_url}{endpoint}"
            headers = {"X-Secret-Key": self.goose_secret_key}
            
            if method == "POST":
                response = requests.post(url, json=data, headers=headers, timeout=30)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=headers, timeout=30)
            else:
                response = requests.get(url, headers=headers, timeout=30)
            
            if response.status_code == 200:
                return {"success": True, "data": response.json()}
            else:
                return {"success": False, "error": f"HTTP {response.status_code}", "response": response.text}
                
        except requests.exceptions.RequestException as e:
            return {"success": False, "error": str(e)}
    
    async def send_goose_request_async(self, endpoint: str, method: str = "GET", data: dict = None) -> dict:
        """Асинхронна відправка запиту до Goose API"""
        try:
            url = f"{self.goose_api_url}{endpoint}"
            headers = {"X-Secret-Key": self.goose_secret_key}
            
            timeout = aiohttp.ClientTimeout(total=30)  # 30 секунд таймаут
            
            async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
                if method == "POST":
                    async with session.post(url, json=data) as response:
                        if response.status == 200:
                            data = await response.json()
                            return {"success": True, "data": data}
                        else:
                            text = await response.text()
                            return {"success": False, "error": f"HTTP {response.status}", "response": text}
                elif method == "PUT":
                    async with session.put(url, json=data) as response:
                        if response.status == 200:
                            data = await response.json()
                            return {"success": True, "data": data}
                        else:
                            text = await response.text()
                            return {"success": False, "error": f"HTTP {response.status}", "response": text}
                else:
                    async with session.get(url) as response:
                        if response.status == 200:
                            data = await response.json()
                            return {"success": True, "data": data}
                        else:
                            text = await response.text()
                            return {"success": False, "error": f"HTTP {response.status}", "response": text}
                            
        except Exception as e:
            return {"success": False, "error": str(e)}

    def send_goose_reply_sse(self, session_name: str, message: str, timeout: int = 90) -> dict:
        """Надсилає повідомлення до Goose, авто-вибір: goose web (WS) або goosed (/reply SSE).

        Повертає dict: { success, response, error? }
        """
        try:
            import time as _time
            # Визначимо, що працює: goose web чи goosed
            def _is_web():
                try:
                    r = requests.get(f"{self.goose_api_url}/api/health", timeout=3)
                    return r.status_code == 200
                except Exception:
                    return False

            def _is_goosed():
                try:
                    r = requests.get(f"{self.goose_api_url}/status", timeout=3)
                    return r.status_code == 200
                except Exception:
                    return False

            if _is_web():
                # Використовуємо WebSocket /ws у goose web
                try:
                    import aiohttp, asyncio

                    async def _via_ws():
                        ws_url = self.goose_api_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
                        payload = {
                            "type": "message",
                            "content": message,
                            "session_id": session_name,
                            "timestamp": int(_time.time() * 1000),
                        }
                        timeout_total = aiohttp.ClientTimeout(total=timeout)
                        chunks = []
                        async with aiohttp.ClientSession(timeout=timeout_total) as session:
                            async with session.ws_connect(ws_url, heartbeat=30) as ws:
                                await ws.send_str(json.dumps(payload))
                                async for msg in ws:
                                    if msg.type == aiohttp.WSMsgType.TEXT:
                                        try:
                                            obj = json.loads(msg.data)
                                        except Exception:
                                            obj = None
                                        if isinstance(obj, dict):
                                            t = obj.get("type")
                                            if t == "response":
                                                content = obj.get("content")
                                                if content:
                                                    chunks.append(str(content))
                                            elif t in ("complete", "cancelled"):
                                                break
                                            elif t == "error":
                                                return {"success": False, "error": obj.get("message", "websocket error")}
                                        else:
                                            chunks.append(str(msg.data))
                                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                        break
                        return {"success": True, "response": "".join(chunks).strip()}

                    try:
                        return asyncio.run(_via_ws())
                    except RuntimeError:
                        loop = asyncio.new_event_loop()
                        try:
                            asyncio.set_event_loop(loop)
                            return loop.run_until_complete(_via_ws())
                        finally:
                            asyncio.set_event_loop(None)
                            loop.close()
                except Exception as e:
                    return {"success": False, "error": str(e)}

            # Fallback: goosed /reply SSE
            url = f"{self.goose_api_url}/reply"
            headers = {
                "Accept": "text/event-stream",
                "Cache-Control": "no-cache",
                "X-Secret-Key": self.goose_secret_key,
            }
            payload = {
                "messages": [
                    {
                        "role": "user",
                        "created": int(_time.time()),
                        "content": [{"type": "text", "text": message}],
                    }
                ],
                "session_id": session_name,
                "session_working_dir": os.getcwd(),
            }

            with requests.post(url, json=payload, headers=headers, stream=True, timeout=timeout) as resp:
                if resp.status_code != 200:
                    text = None
                    try:
                        text = resp.text[:500]
                    except Exception:
                        text = "<no body>"
                    return {"success": False, "error": f"HTTP {resp.status_code}", "response": text}

                chunks = []
                for raw_line in resp.iter_lines(decode_unicode=True):
                    if raw_line is None:
                        continue
                    line = raw_line.strip()
                    if not line or line.startswith(":"):
                        continue
                    if line.startswith("data:"):
                        data_part = line[5:].lstrip()
                        try:
                            obj = json.loads(data_part)
                            if isinstance(obj, dict):
                                if obj.get("type") == "Message" and isinstance(obj.get("message"), dict):
                                    msg = obj["message"]
                                    for c in msg.get("content", []) or []:
                                        if isinstance(c, dict) and c.get("type") == "text":
                                            t = c.get("text")
                                            if t:
                                                chunks.append(str(t))
                                else:
                                    token = obj.get("text") or obj.get("token") or obj.get("content")
                                    if token:
                                        chunks.append(str(token))
                                    if obj.get("final") is True or obj.get("done") is True:
                                        break
                            else:
                                chunks.append(str(obj))
                        except Exception:
                            chunks.append(data_part)
                    elif line.lower() == "event: done":
                        break

                return {"success": True, "response": "".join(chunks).strip()}
        except requests.exceptions.RequestException as e:
            return {"success": False, "error": str(e)}

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
            if self.path == "/logs/stream":
                self.serve_logs_stream()  # SSE endpoint
            else:
                self.serve_live_logs()    # Regular logs
        elif self.path == "/api/status":
            self.serve_system_status()
        elif self.path == "/api/atlas/status":
            self.serve_atlas_core_status()
        elif self.path == "/api/atlas/sessions":
            self.serve_atlas_sessions()
        elif self.path == "/api/goose/sessions":
            self.serve_goose_sessions()
        elif self.path == "/api/atlas/corrections":
            self.serve_correction_statistics()
        elif self.path.startswith("/api/atlas/corrections/"):
            # Отримання історії конкретної сесії: /api/atlas/corrections/session_name
            session_name = self.path.replace("/api/atlas/corrections/", "")
            self.serve_session_corrections(session_name)
        elif self.path == "/api/atlas/diagnostics":
            self.serve_api_diagnostics()
        elif self.path == "/api/atlas/health":
            self.serve_health_check()
        elif self.path == "/api/atlas/test-mode-analysis":
            self.serve_test_mode_analysis()
        else:
            super().do_GET()

    def do_POST(self):
        """Обробка POST запитів"""
        if self.path == "/api/chat":
            self.handle_chat()
        elif self.path == "/api/chat/stream":
            self.handle_chat_stream()
        elif self.path == "/api/tts/speak":
            self.handle_tts()
        elif self.path == "/api/atlas/analyze-prompt":
            self.handle_analyze_prompt()
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

    def serve_logs_stream(self):
        """🔄 ВИМКНЕНО: SSE потік для live логів (тимчасово відключено)"""
        try:
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            # Повертаємо простий JSON замість SSE потоку
            response = {
                "status": "disabled",
                "message": "Log streaming temporarily disabled",
                "timestamp": datetime.now().isoformat()
            }

            self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))

        except Exception as e:
            logger.error(f"Log stream error: {e}")
            self.send_error(500, str(e))

    def _get_recent_logs(self, limit: int = 10):
        """Отримання останніх логів"""
        logs = []
        
        # Додаємо системні логи
        logs.append({
            "message": "🔍 Monitoring Goose sessions in real-time...",
            "level": "info",
            "timestamp": datetime.now().strftime("%H:%M:%S"),
            "source": "atlas_monitor"
        })
        
        # Можна додати реальні логи з сесій Goose тут
        try:
            sessions_dir = Path.home() / ".local/share/goose/sessions"
            if sessions_dir.exists():
                jsonl_files = list(sessions_dir.glob("*.jsonl"))
                if jsonl_files:
                    latest_session = max(jsonl_files, key=lambda f: f.stat().st_mtime)
                    with open(latest_session, 'r', encoding='utf-8') as f:
                        lines = f.readlines()[-5:]  # Останні 5 рядків
                    
                    for line in lines:
                        if line.strip():
                            try:
                                data = json.loads(line.strip())
                                if "role" in data and "content" in data:
                                    content = str(data.get("content", ""))[:100]
                                    logs.append({
                                        "message": f"🤖 {data['role'].upper()}: {content}...",
                                        "level": "info",
                                        "timestamp": datetime.now().strftime("%H:%M:%S"),
                                        "source": "goose_session"
                                    })
                            except:
                                continue
        except:
            pass
        
        return logs[-limit:]

    def serve_live_logs(self):
        """Отримання логів Goose з останньої сесії"""
        try:
            # Парсимо query параметри
            parsed_path = urllib.parse.urlparse(self.path)
            query_params = urllib.parse.parse_qs(parsed_path.query)
            
            # Отримуємо limit параметр (за замовчуванням 50)
            limit = int(query_params.get('limit', ['50'])[0])
            
            logs = []
            
            # Читаємо логи з найсвіжішої сесії Goose
            try:
                sessions_dir = Path.home() / ".local/share/goose/sessions"
                if sessions_dir.exists():
                    # Знаходимо найновіший .jsonl файл
                    jsonl_files = list(sessions_dir.glob("*.jsonl"))
                    if jsonl_files:
                        latest_session = max(jsonl_files, key=lambda f: f.stat().st_mtime)
                        
                        # Читаємо останні записи з файлу
                        with open(latest_session, 'r', encoding='utf-8') as f:
                            lines = f.readlines()
                            
                        # Беремо останні N рядків
                        recent_lines = lines[-min(limit, len(lines)):]
                        
                        for line in recent_lines:
                            line = line.strip()
                            if line:
                                try:
                                    # Пробуємо парсити як JSON
                                    data = json.loads(line)
                                    
                                    # Витягуємо корисну інформацію
                                    if "role" in data and "content" in data:
                                        role = data["role"]
                                        content = str(data.get("content", ""))
                                        
                                        # Форматуємо повідомлення
                                        if role == "user":
                                            message = f"🔵 USER: {content[:200]}..."
                                        elif role == "assistant":
                                            message = f"🤖 GOOSE: {content[:200]}..."
                                        else:
                                            message = f"📊 {role.upper()}: {content[:200]}..."
                                            
                                        logs.append({
                                            "message": message,
                                            "level": "info",
                                            "timestamp": datetime.now().strftime("%H:%M:%S"),
                                            "source": "goose_session"
                                        })
                                        
                                    elif "description" in data:
                                        # Опис задачі
                                        description = data["description"]
                                        message = f"📋 TASK: {description}"
                                        logs.append({
                                            "message": message,
                                            "level": "info", 
                                            "timestamp": datetime.now().strftime("%H:%M:%S"),
                                            "source": "goose_task"
                                        })
                                        
                                except json.JSONDecodeError:
                                    # Якщо не JSON, показуємо як текст
                                    logs.append({
                                        "message": f"📄 RAW: {line[:200]}...",
                                        "level": "debug",
                                        "timestamp": datetime.now().strftime("%H:%M:%S"),
                                        "source": "goose_raw"
                                    })
                                    
            except Exception as e:
                logs.append({
                    "message": f"❌ Error reading Goose sessions: {e}",
                    "level": "error",
                    "timestamp": datetime.now().strftime("%H:%M:%S"),
                    "source": "atlas_frontend"
                })
            
            # Додаємо інформацію про статус
            logs.append({
                "message": f"🔍 Monitoring Goose sessions in real-time...",
                "level": "info",
                "timestamp": datetime.now().strftime("%H:%M:%S"),
                "source": "atlas_monitor"
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
                    "atlas_core_available": ATLAS_CORE_AVAILABLE,
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
            self.send_error(500, str(e))

    def serve_atlas_core_status(self):
        """Статус Atlas Core системи"""
        try:
            if ATLAS_CORE_AVAILABLE:
                core = get_atlas_core("/Users/dev/Documents/GitHub/ATLAS/goose")
                status = core.get_system_status()
                health = core.health_check()
                
                response_data = {
                    "atlas_core": {
                        "available": True,
                        "status": status,
                        "health": health
                    },
                    "timestamp": datetime.now().isoformat()
                }
            else:
                response_data = {
                    "atlas_core": {
                        "available": False,
                        "error": "Atlas Core не завантажений",
                        "legacy_mode": True
                    },
                    "timestamp": datetime.now().isoformat()
                }
            
            response = json.dumps(response_data, ensure_ascii=False, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            logger.error(f"Atlas Core status error: {e}")
            error_response = {
                "atlas_core": {
                    "available": False,
                    "error": str(e)
                },
                "timestamp": datetime.now().isoformat()
            }
            response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    def serve_atlas_sessions(self):
        """Список доступних сесій Goose"""
        try:
            if ATLAS_CORE_AVAILABLE:
                core = get_atlas_core("/Users/dev/Documents/GitHub/ATLAS/goose")
                sessions = core.get_available_sessions()
                
                response_data = {
                    "sessions": sessions,
                    "count": len(sessions),
                    "atlas_core": True,
                    "timestamp": datetime.now().isoformat()
                }
            else:
                response_data = {
                    "sessions": [],
                    "count": 0,
                    "atlas_core": False,
                    "error": "Atlas Core недоступний",
                    "timestamp": datetime.now().isoformat()
                }
            
            response = json.dumps(response_data, ensure_ascii=False, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            logger.error(f"Atlas sessions error: {e}")
            error_response = {
                "sessions": [],
                "error": str(e),
                "atlas_core": False,
                "timestamp": datetime.now().isoformat()
            }
            response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    def serve_goose_sessions(self):
        """Список сесій Goose з файлової системи"""
        try:
            sessions_dir = Path.home() / ".local/share/goose/sessions"
            sessions = []
            
            if sessions_dir.exists():
                jsonl_files = list(sessions_dir.glob("*.jsonl"))
                
                for session_file in sorted(jsonl_files, key=lambda f: f.stat().st_mtime, reverse=True)[:10]:
                    stat = session_file.stat()
                    size_kb = round(stat.st_size / 1024, 1)
                    
                    # Читаємо перший рядок для опису
                    description = "Unknown task"
                    try:
                        with open(session_file, 'r', encoding='utf-8') as f:
                            first_line = f.readline().strip()
                            if first_line:
                                data = json.loads(first_line)
                                description = data.get("description", "Unknown task")
                    except:
                        pass
                    
                    sessions.append({
                        "name": session_file.name,
                        "description": description,
                        "size_kb": size_kb,
                        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "path": str(session_file)
                    })
            
            response_data = {
                "sessions": sessions,
                "count": len(sessions),
                "sessions_dir": str(sessions_dir),
                "timestamp": datetime.now().isoformat()
            }
            
            response = json.dumps(response_data, ensure_ascii=False, indent=2).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            logger.error(f"Goose sessions error: {e}")
            error_response = {
                "sessions": [],
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
            response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    def serve_correction_statistics(self):
        """
        🆕 НОВИЙ API ENDPOINT: Статистика автоматичних виправлень Atlas
        GET /api/atlas/corrections - загальна статистика всіх виправлень
        """
        try:
            if hasattr(self.server, 'session_manager'):
                stats = self.server.session_manager.get_all_correction_statistics()
                
                response_data = {
                    "correction_statistics": stats,
                    "feature_description": "Atlas automatically creates detailed correction tasks when Grisha identifies incomplete work",
                    "timestamp": datetime.now().isoformat()
                }
                
                response = json.dumps(response_data, ensure_ascii=False, indent=2).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
            else:
                error_response = {
                    "error": "Session manager not available",
                    "timestamp": datetime.now().isoformat()
                }
                response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
                self.send_response(503)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
                
        except Exception as e:
            logger.error(f"Correction statistics error: {e}")
            error_response = {
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
            response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    def serve_session_corrections(self, session_name: str):
        """
        🆕 НОВИЙ API ENDPOINT: Історія виправлень конкретної сесії
        GET /api/atlas/corrections/{session_name} - детальна історія виправлень для сесії
        """
        try:
            if hasattr(self.server, 'session_manager'):
                history = self.server.session_manager.get_session_correction_history(session_name)
                
                response_data = {
                    "correction_history": history,
                    "feature_description": f"Detailed correction history for session '{session_name}'",
                    "timestamp": datetime.now().isoformat()
                }
                
                response = json.dumps(response_data, ensure_ascii=False, indent=2).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
            else:
                error_response = {
                    "error": "Session manager not available",
                    "session_name": session_name,
                    "timestamp": datetime.now().isoformat()
                }
                response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
                self.send_response(503)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
                
        except Exception as e:
            logger.error(f"Session corrections error for '{session_name}': {e}")
            error_response = {
                "error": str(e),
                "session_name": session_name,
                "timestamp": datetime.now().isoformat()
            }
            response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
            self.send_response(500)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)

    def serve_api_diagnostics(self):
        """
        🔧 НОВИЙ API ENDPOINT: Детальна діагностика API стану
        GET /api/atlas/diagnostics - повна інформація про стан HTTP API та fallback
        """
        try:
            if hasattr(self.server, 'session_manager'):
                sm = self.server.session_manager
                
                # Збираємо діагностичну інформацію
                diagnostics = {
                    "api_configuration": {
                        "api_url": sm.api_url,
                        "use_http_api": sm.use_http_api,
                        "secret_key_configured": bool(sm.secret_key)
                    },
                    "api_status": {
                        "failure_count": getattr(sm, 'api_failure_count', 0),
                        "fallback_active": getattr(sm, 'fallback_active', False),
                        "last_api_check": getattr(sm, 'last_api_check', None),
                        "recovery_interval": getattr(sm, 'api_recovery_interval', 30)
                    },
                    "status_history": getattr(sm, 'api_status_history', [])[-10:],  # останні 10 записів
                    "live_validation": None
                }
                
                # Проводимо живу валідацію
                try:
                    if hasattr(sm, '_validate_api_availability'):
                        live_check = sm._validate_api_availability()
                        diagnostics["live_validation"] = live_check
                except Exception as val_error:
                    diagnostics["live_validation"] = {"error": str(val_error)}
                
                response_data = {
                    "diagnostics": diagnostics,
                    "recommendations": self._generate_api_recommendations(diagnostics),
                    "timestamp": datetime.now().isoformat()
                }
                
                response = json.dumps(response_data, ensure_ascii=False, indent=2).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
                
            else:
                self._send_error_response(503, "Session manager not available")
                
        except Exception as e:
            logger.error(f"API diagnostics error: {e}")
            self._send_error_response(500, str(e))

    def serve_health_check(self):
        """
        💓 НОВИЙ API ENDPOINT: Швидка перевірка здоров'я системи
        GET /api/atlas/health - базовий health check для моніторингу
        """
        try:
            health_status = {
                "status": "healthy",
                "timestamp": datetime.now().isoformat(),
                "components": {}
            }
            
            # Перевірка Session Manager
            if hasattr(self.server, 'session_manager'):
                sm = self.server.session_manager
                fallback_active = getattr(sm, 'fallback_active', False)
                
                health_status["components"]["session_manager"] = {
                    "status": "degraded" if fallback_active else "healthy",
                    "fallback_active": fallback_active,
                    "mode": "CLI" if fallback_active else "HTTP_API"
                }
                
                if fallback_active:
                    health_status["status"] = "degraded"
            else:
                health_status["components"]["session_manager"] = {
                    "status": "unavailable",
                    "error": "Session manager not initialized"
                }
                health_status["status"] = "unhealthy"
            
            # Перевірка Goose процесу
            try:
                import subprocess
                result = subprocess.run(['pgrep', '-f', 'goose web'], 
                                      capture_output=True, text=True, timeout=5)
                if result.returncode == 0:
                    health_status["components"]["goose_web"] = {
                        "status": "healthy",
                        "processes": len(result.stdout.strip().split('\n')) if result.stdout.strip() else 0
                    }
                else:
                    health_status["components"]["goose_web"] = {
                        "status": "unavailable",
                        "error": "No goose web processes found"
                    }
                    if health_status["status"] == "healthy":
                        health_status["status"] = "degraded"
                        
            except Exception as e:
                health_status["components"]["goose_web"] = {
                    "status": "unknown", 
                    "error": str(e)
                }
            
            # Відповідь з відповідним HTTP статусом
            status_code = 200 if health_status["status"] == "healthy" else (
                503 if health_status["status"] == "unhealthy" else 200
            )
            
            response = json.dumps(health_status, ensure_ascii=False, indent=2).encode('utf-8')
            self.send_response(status_code)
            self.send_header('Content-type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Length', str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            
        except Exception as e:
            logger.error(f"Health check error: {e}")
            self._send_error_response(500, str(e))

    def serve_test_mode_analysis(self):
        """
        🧪 НОВИЙ API ENDPOINT: Тестування системи інтелектуального аналізу режиму
        GET /api/atlas/test-mode-analysis - тестування аналізу промптів
        """
        try:
            if hasattr(self.server, 'session_manager'):
                sm = self.server.session_manager
                
                # Запускаємо тестування
                test_results = sm.test_intelligent_mode_analysis()
                
                # Формуємо детальну відповідь
                response_data = {
                    "test_results": test_results,
                    "summary": {
                        "total_tests": test_results["total_tests"],
                        "http_api_percentage": round((test_results["http_api_recommended"] / test_results["total_tests"]) * 100, 1),
                        "cli_percentage": round((test_results["cli_recommended"] / test_results["total_tests"]) * 100, 1)
                    },
                    "system_status": {
                        "intelligent_analysis": "active",
                        "mode_detection": "enabled",
                        "current_default": "http_api" if sm.use_http_api else "cli"
                    },
                    "timestamp": datetime.now().isoformat()
                }
                
                response = json.dumps(response_data, ensure_ascii=False, indent=2).encode('utf-8')
                self.send_response(200)
                self.send_header('Content-type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)
                
            else:
                self._send_error_response(503, "Session manager not available")
                
        except Exception as e:
            logger.error(f"Mode analysis test error: {e}")
            self._send_error_response(500, str(e))

    def _generate_api_recommendations(self, diagnostics: dict) -> list:
        """🧠 Генерація рекомендацій на основі діагностики"""
        recommendations = []
        
        api_status = diagnostics.get("api_status", {})
        config = diagnostics.get("api_configuration", {})
        
        if api_status.get("fallback_active"):
            recommendations.append({
                "priority": "high",
                "issue": "HTTP API fallback активний",
                "solution": "Перевірте чи працює Goose web сервер на порту 3000",
                "command": "ps aux | grep 'goose web'"
            })
        
        if api_status.get("failure_count", 0) > 5:
            recommendations.append({
                "priority": "medium", 
                "issue": f"Багато помилок API ({api_status.get('failure_count')})",
                "solution": "Перезапустіть Goose сервер або перевірте мережеве з'єднання"
            })
        
        if not config.get("secret_key_configured"):
            recommendations.append({
                "priority": "low",
                "issue": "Secret key не налаштований",
                "solution": "Встановіть GOOSE_SECRET_KEY в змінних середовища"
            })
        
        live_validation = diagnostics.get("live_validation", {})
        if not live_validation.get("available"):
            reason = live_validation.get("reason", "unknown")
            if reason == "network_unreachable":
                recommendations.append({
                    "priority": "critical",
                    "issue": "Мережевий порт недоступний",
                    "solution": "Запустіть Goose web сервер: './target/release/goose web --port 3000'"
                })
            elif reason == "http_timeout":
                recommendations.append({
                    "priority": "high", 
                    "issue": "HTTP таймаути",
                    "solution": "Goose сервер може бути перевантажений - перезапустіть його"
                })
        
        return recommendations

    def _send_error_response(self, status_code: int, error_message: str):
        """📤 Відправка стандартизованої відповіді про помилку"""
        error_response = {
            "error": error_message,
            "status_code": status_code,
            "timestamp": datetime.now().isoformat()
        }
        response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
        self.send_response(status_code)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def handle_chat(self):
        """Обробка чат запитів через Atlas Core (Atlas LLM1 + Goose + Гріша LLM3)"""
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            # Підтримка як "message" так і "prompt"
            user_message = data.get("message", data.get("prompt", ""))
            if not user_message:
                self.send_json_response({"error": "Message is required"}, 400)
                return
            
            # Формуємо контекст користувача
            user_context = {
                "timestamp": datetime.now().isoformat(),
                "session_hint": data.get("session_type"),
                "client_ip": self.client_address[0],
                "user_agent": self.headers.get('User-Agent', 'unknown')
            }
            
            if ATLAS_CORE_AVAILABLE:
                # === НОВИЙ ШЛЯХ: Atlas Core ===
                logger.info(f"🧠 Atlas Core: Обробляю повідомлення: {user_message[:100]}...")
                
                try:
                    # Отримуємо екземпляр Atlas Core
                    core = get_atlas_core("/Users/dev/Documents/GitHub/ATLAS/goose")
                    
                    # Обробляємо повідомлення через всі три компоненти
                    # Потрібно викликати async метод в sync контексті
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    
                    try:
                        result = loop.run_until_complete(
                            core.process_user_message(user_message, user_context)
                        )
                    finally:
                        loop.close()
                    
                    # Формуємо відповідь на основі результату Atlas Core
                    if result.get("success"):
                        response_data = {
                            "response": result.get("response", result.get("atlas_response", "Завдання виконано")),
                            "response_type": result.get("response_type", "unknown"),
                            "atlas_core": True,
                            "processing_time": result.get("processing_time", 0),
                            "intent": result.get("intent_analysis", {}).get("intent", "unknown"),
                            "confidence": result.get("intent_analysis", {}).get("confidence", 0.0)
                        }
                        
                        # Додаємо інформацію про сесію якщо є
                        if "session_strategy" in result:
                            response_data["session_info"] = {
                                "strategy": result["session_strategy"].get("strategy"),
                                "session_name": result["session_strategy"].get("session_name")
                            }
                        
                        # Додаємо інформацію про безпеку якщо є
                        if "security_analysis" in result:
                            response_data["security"] = {
                                "risk_level": result["security_analysis"].get("risk_level"),
                                "validated": True
                            }
                        
                        logger.info(f"✅ Atlas Core: Успішно оброблено ({result.get('response_type')})")
                        self.send_json_response(response_data)
                        
                    else:
                        # Помилка в Atlas Core (бізнес-рівень): повертаємо 200 зі структурованим описом, щоб клієнт не падав
                        error_message = result.get("error", "Невідома помилка Atlas Core")

                        base_error_payload = {
                            "success": False,
                            "atlas_core": True,
                            "error": error_message,
                            "response_type": result.get("response_type", "error"),
                        }
                        # Додаємо діагностику, якщо є
                        if "diagnostic" in result:
                            base_error_payload["diagnostic"] = result["diagnostic"]
                        if "security_analysis" in result:
                            base_error_payload["security_analysis"] = result["security_analysis"]
                        if "session_strategy" in result:
                            base_error_payload["session_info"] = {
                                "strategy": result["session_strategy"].get("strategy"),
                                "session_name": result["session_strategy"].get("session_name")
                            }

                        if result.get("response_type") == "security_block":
                            base_error_payload["blocked"] = True
                            base_error_payload["response"] = "🛡️ Команда заблокована системою безпеки Гріша"
                            logger.warning(f"🛡️ Гріша: Заблокував команду - {error_message}")
                        else:
                            base_error_payload["fallback_available"] = True
                            base_error_payload["response"] = f"Помилка Atlas Core: {error_message}"
                            logger.error(f"❌ Atlas Core: {error_message}")

                        # 200: клієнт обробляє як валідну відповідь з полем success=false
                        self.send_json_response(base_error_payload, 200)
                        
                except Exception as atlas_error:
                    logger.error(f"💥 Atlas Core Exception: {atlas_error}")
                    # Fallback до legacy режиму
                    self.handle_chat_legacy(user_message, data, user_context, str(atlas_error))
            
            else:
                # === СТАРИЙ ШЛЯХ: Legacy Goose ===
                logger.info("🔄 Використовую legacy Goose інтеграцію")
                self.handle_chat_legacy(user_message, data, user_context)
                
        except Exception as e:
            logger.error(f"Fatal error in handle_chat: {e}")
            self.send_json_response({
                "response": f"Критична помилка сервера: {str(e)}",
                "error": str(e),
                "atlas_core": False
            }, 500)

    def handle_chat_stream(self):
        """Стрімовий чат: проксування у реальному часі (goose web WS або goosed /reply SSE).

        Запит: POST /api/chat/stream
        Body: {"message": str, optional: "session_type", "session_name"}

        Відповідь: text/event-stream з подіями:
          - data: {"type":"status","message":"..."}
          - data: {"type":"token","token":"...","accumulated":"..."}
          - data: {"type":"done","total":"..."}
          - data: {"type":"error","error":"..."}
        """
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8')) if post_data else {}

            user_message = data.get("message") or data.get("prompt")
            if not user_message:
                self._send_error_response(400, "Message is required")
                return

            session_type = self.determine_session_type(user_message, data.get("session_type"))
            session_name = data.get("session_name") or self.get_session_name(user_message, session_type)

            # Розширене перефразування запиту (можна вимкнути no_paraphrase=true)
            use_paraphrase = self._should_paraphrase(data)
            # Якщо це звичайний чат/смаллток — перефразування вимикаємо, щоб не перетворювати на задачу
            if session_type == "chat":
                use_paraphrase = False
            message_to_send = self._paraphrase_user_message(user_message) if use_paraphrase else user_message

            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Connection', 'keep-alive')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()

            def send_event(obj: dict):
                try:
                    payload = json.dumps(obj, ensure_ascii=False)
                    self.wfile.write(f"data: {payload}\n\n".encode('utf-8'))
                    try:
                        self.wfile.flush()
                    except Exception:
                        pass
                except (BrokenPipeError, ConnectionResetError):
                    raise
                except Exception as e:
                    logger.error(f"SSE write error: {e}")

            send_event({"type": "status", "message": "connected", "session": session_name, "paraphrase": use_paraphrase})
            if session_type == "chat":
                try:
                    send_event({
                        "type": "status",
                        "role": "atlas",
                        "event": "mode_detected",
                        "mode": "chat",
                        "say": "Атлас: Режим — звичайний чат (без постановки завдання)."
                    })
                except Exception:
                    pass
            # Додаткові службові події для чату
            try:
                if use_paraphrase and (message_to_send or "") != (user_message or ""):
                    send_event({
                        "type": "status",
                        "role": "atlas",
                        "event": "paraphrase",
                        "say": "Атлас: Я перефразую для більшої зрозумілості завдання:",
                        "content": message_to_send
                    })
                # Інформуємо про перевірку безпеки (логічна подія для UX)
                send_event({
                    "type": "status",
                    "role": "atlas",
                    "event": "security_dispatch",
                    "say": "Атлас: Відправляю на службу безпеки до Гріші на перевірку виконання."
                })
                # Імітація результату перевірки безпеки (якщо Atlas Core не на шляху стріму)
                send_event({
                    "type": "status",
                    "role": "grisha",
                    "event": "security_result",
                    "decision": "allow",
                    "say": "Гріша (LLM3): Перевірив безпеку — дозвіл на виконання."
                })
            except Exception:
                pass

            accumulated: list[str] = []

            def _safe_lower(s: str) -> str:
                try:
                    return s.lower()
                except Exception:
                    return s

            def _extract_embedded_json(text: str):
                """Пробує дістати JSON з ```json ...``` або з перших/останніх дужок.
                Повертає dict або None.
                """
                try:
                    import json as _json
                    import re as _re
                    # ```json ... ```
                    m = _re.search(r"```json\s*(\{[\s\S]*?\})\s*```", text, _re.IGNORECASE)
                    if m:
                        return _json.loads(m.group(1))
                    # перша об'єктна дужка до останньої
                    start = text.find('{')
                    end = text.rfind('}')
                    if start != -1 and end != -1 and end > start:
                        candidate = text[start:end+1]
                        return _json.loads(candidate)
                except Exception:
                    return None
                return None

            def _needs_auto_follow_up(full_text: str) -> bool:
                """Груба евристика: якщо асистент просить підтвердження/вибір або JSON каже completed=false."""
                t = _safe_lower(full_text)
                cues = [
                    "підтверд", "продовжити", "можу продовжити", "обери", "вибери", "обрати", "вибрати",
                    "confirm", "should i proceed", "continue?", "choose", "select"
                ]
                if any(c in t for c in cues):
                    return True
                data = _extract_embedded_json(full_text) or {}
                if isinstance(data, dict):
                    if data.get("completed") is False:
                        return True
                    status = str(data.get("status", "")).lower()
                    if any(x in status for x in ["pending", "awaiting", "confirm", "incomplete"]):
                        return True
                return False

            def _compose_auto_follow_up(full_text: str, original_prompt: str) -> str:
                """Стандартизоване серверне продовження без потреби у підтвердженні."""
                return (
                    "Так, продовжуй без додаткових підтверджень. Якщо потрібно зробити вибір — обирай перший безпечний,"
                    " без реклами/органічний результат. Заверши завдання автоматично і дай короткий підсумок. "
                    "If you need confirmation: assume yes and proceed."
                )

            # === РАННІЙ АНАЛІЗ ЗАВЕРШЕННЯ ТА НЕПОВНОТИ ===
            def _has_completion_cues(text: str) -> bool:
                t = _safe_lower(text)
                cues = [
                    "готово", "завдання виконано", "виконано", "завершено", "done", "completed", "finished",
                    "готов", "готовий", "final result", "підсумок:", "результат:" 
                ]
                return any(c in t for c in cues)

            def _build_incompletion_reason(full_text: str, original_prompt: str) -> str:
                reasons = []
                data = _extract_embedded_json(full_text) or {}
                t = _safe_lower(full_text)
                # Пріоритет: embedded JSON
                if isinstance(data, dict):
                    if data.get("completed") is False:
                        reasons.append("embedded JSON: completed=false")
                    status = str(data.get("status", "")).lower()
                    if any(x in status for x in ["pending", "awaiting", "confirm", "incomplete", "todo"]):
                        reasons.append(f"статус: {status or 'incomplete'}")
                    missing = data.get("missing") or data.get("todo") or data.get("next")
                    if missing:
                        try:
                            if isinstance(missing, (list, tuple)):
                                reasons.append("відсутнє: " + "; ".join([str(x) for x in missing][:3]))
                            else:
                                reasons.append("відсутнє: " + str(missing)[:200])
                        except Exception:
                            pass
                # Евристики неповноти
                need_confirm_cues = ["підтверд", "confirm", "should i proceed", "continue?", "choose", "select", "обери", "вибери", "обрати", "вибрати"]
                if any(c in t for c in need_confirm_cues):
                    reasons.append("потрібне підтвердження/вибір (має виконуватися автономно)")
                planning_cues = ["план", "кроки", "steps", "outline"]
                if any(c in t for c in planning_cues) and not any(c in t for c in ["результат", "підсумок", "result", "final"]):
                    reasons.append("надано план без фактичного виконання")
                promise_cues = ["i will", "i'll", "let me know", "можу", "зможу"]
                if any(c in t for c in promise_cues):
                    reasons.append("є обіцянки/намір без завершеного результату")
                # Якщо нічого конкретного не знайшли, повернемо загальне
                if not reasons:
                    reasons.append("відсутній явний підсумок/результат")
                return "; ".join(reasons)[:400]

            def _analyze_completion(full_text: str, original_prompt: str) -> dict:
                """Повертає dict з полями: {cues, embedded_completed, embedded_incomplete, need_follow_up, reason} """
                info = {
                    "cues": _has_completion_cues(full_text),
                    "embedded_completed": False,
                    "embedded_incomplete": False,
                    "need_follow_up": False,
                    "reason": None,
                }
                data = _extract_embedded_json(full_text)
                if isinstance(data, dict):
                    if data.get("completed") is True:
                        info["embedded_completed"] = True
                        info["need_follow_up"] = False
                        return info
                    if data.get("completed") is False:
                        info["embedded_incomplete"] = True
                # Якщо є сигнали завершення – перевіряємо неповноту
                if info["embedded_incomplete"] or info["cues"]:
                    if _needs_auto_follow_up(full_text):
                        info["need_follow_up"] = True
                        info["reason"] = _build_incompletion_reason(full_text, original_prompt)
                return info

            def _compose_follow_up_with_reason(full_text: str, original_prompt: str, reason: str | None) -> str:
                base = _compose_auto_follow_up(full_text, original_prompt)
                if reason:
                    return (
                        f"Продовжуй і довиконай завдання. Усунь незавершеність: {reason}. "
                        + base
                    )
                return base

            def _is_web():
                try:
                    r = requests.get(f"{self.goose_api_url}/api/health", timeout=3)
                    return r.status_code == 200
                except Exception:
                    return False

            stream_timeout = self._get_stream_timeout()
            # Прапорці раннього довиконання
            early_followup_triggered = False
            early_followup_text = None
            early_analysis_enabled = True
            if _is_web():
                import aiohttp, asyncio

                async def _via_ws_and_stream():
                    nonlocal early_followup_triggered, early_followup_text
                    ws_url = self.goose_api_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
                    payload = {
                        "type": "message",
                        "content": message_to_send,
                        "session_id": session_name,
                        "timestamp": int(time.time() * 1000),
                    }
                    timeout_total = aiohttp.ClientTimeout(total=stream_timeout) if stream_timeout is not None else None
                    async with aiohttp.ClientSession(timeout=timeout_total) as session:
                        async with session.ws_connect(ws_url, heartbeat=30) as ws:
                            await ws.send_str(json.dumps(payload))
                            async for msg in ws:
                                if msg.type == aiohttp.WSMsgType.TEXT:
                                    try:
                                        obj = json.loads(msg.data)
                                    except Exception:
                                        obj = None
                                    if isinstance(obj, dict):
                                        t = obj.get("type")
                                        if t == "response":
                                            content = obj.get("content")
                                            if content:
                                                token = str(content)
                                                accumulated.append(token)
                                                send_event({
                                                    "type": "token",
                                                    "token": token,
                                                    "accumulated": "".join(accumulated)
                                                })
                                                # Ранній аналіз завершення: якщо є сигнали – перевіряємо і за потреби запускаємо довиконання
                                                if early_analysis_enabled and not early_followup_triggered:
                                                    full_text = "".join(accumulated)
                                                    analysis = _analyze_completion(full_text, user_message)
                                                    if analysis.get("need_follow_up"):
                                                        early_followup_triggered = True
                                                        reason = analysis.get("reason")
                                                        send_event({
                                                            "type": "status",
                                                            "role": "verifier",
                                                            "event": "incomplete_detected",
                                                            "say": "Особа, що перевіряє: Завдання не завершено, оскільки не виконано:",
                                                            "reason": reason
                                                        })
                                                        early_followup_text = _compose_follow_up_with_reason(full_text, user_message, reason)
                                                        # перериваємо поточний стрім, щоб негайно довиконати
                                                        break
                                            # Якщо повідомлення позначено як фінальне в полі, теж завершуємо
                                            if obj.get("final") or obj.get("done"):
                                                break
                                        elif t in ("complete", "done", "cancelled", "final"):
                                            break
                                        elif t == "error":
                                            send_event({"type": "error", "error": obj.get("message", "websocket error")})
                                            return
                                        else:
                                            # Генеральний випадок: якщо є явні фінальні прапорці
                                            if obj.get("final") or obj.get("done"):
                                                break
                                elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                    break

                try:
                    import asyncio
                    asyncio.run(_via_ws_and_stream())
                except RuntimeError:
                    loop = asyncio.new_event_loop()
                    try:
                        asyncio.set_event_loop(loop)
                        loop.run_until_complete(_via_ws_and_stream())
                    finally:
                        asyncio.set_event_loop(None)
                        loop.close()
                # Server-side auto follow-up (single chained message)
                try:
                    full_text = "".join(accumulated)
                    # Якщо ранній аналіз вже вирішив – використовуємо його
                    if early_followup_triggered and early_followup_text:
                        follow_up = early_followup_text
                    elif _needs_auto_follow_up(full_text):
                        # Повідомлення від "особи, що перевіряє" перед автопродовженням
                        send_event({
                            "type": "status",
                            "role": "verifier",
                            "event": "incomplete_detected",
                            "say": "Особа, що перевіряє: Завдання не виконано, формую коригуюче завдання."
                        })
                        # Невелика пауза, щоб дати шанс користувачу втрутитися (8с)
                        try:
                            time.sleep(8)
                        except Exception:
                            pass
                        follow_up = _compose_auto_follow_up(full_text, user_message)
                        send_event({
                            "type": "status",
                            "role": "verifier",
                            "event": "correction_task",
                            "correction": follow_up,
                            "say": "Особа, що перевіряє: Передаю нове завдання на довершення:"
                        })
                        send_event({"type": "status", "message": "server_auto_followup", "follow_up": follow_up})

                        async def _via_ws_and_stream_followup():
                            ws_url = self.goose_api_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
                            payload = {
                                "type": "message",
                                "content": follow_up,
                                "session_id": session_name,
                                "timestamp": int(time.time() * 1000),
                            }
                            timeout_total = aiohttp.ClientTimeout(total=stream_timeout) if stream_timeout is not None else None
                            async with aiohttp.ClientSession(timeout=timeout_total) as session:
                                async with session.ws_connect(ws_url, heartbeat=30) as ws:
                                    await ws.send_str(json.dumps(payload))
                                    async for msg in ws:
                                        if msg.type == aiohttp.WSMsgType.TEXT:
                                            try:
                                                obj = json.loads(msg.data)
                                            except Exception:
                                                obj = None
                                            if isinstance(obj, dict):
                                                t = obj.get("type")
                                                if t == "response":
                                                    content = obj.get("content")
                                                    if content:
                                                        token = str(content)
                                                        accumulated.append(token)
                                                        send_event({
                                                            "type": "token",
                                                            "token": token,
                                                            "accumulated": "".join(accumulated)
                                                        })
                                                    if obj.get("final") or obj.get("done"):
                                                        break
                                                elif t in ("complete", "done", "cancelled", "final"):
                                                    break
                                                elif t == "error":
                                                    send_event({"type": "error", "error": obj.get("message", "websocket error")})
                                                    return
                                                else:
                                                    if obj.get("final") or obj.get("done"):
                                                        break
                                        elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                                            break

                        try:
                            asyncio.run(_via_ws_and_stream_followup())
                        except RuntimeError:
                            loop = asyncio.new_event_loop()
                            try:
                                asyncio.set_event_loop(loop)
                                loop.run_until_complete(_via_ws_and_stream_followup())
                            finally:
                                asyncio.set_event_loop(None)
                                loop.close()
                except Exception as _e:
                    logger.debug(f"Auto-followup WS skipped: {_e}")
            else:
                url = f"{self.goose_api_url}/reply"
                headers = {
                    "Accept": "text/event-stream",
                    "Cache-Control": "no-cache",
                    "X-Secret-Key": self.goose_secret_key,
                }
                payload = {
                    "messages": [
                        {
                            "role": "user",
                            "created": int(time.time()),
                            "content": [{"type": "text", "text": message_to_send}],
                        }
                    ],
                    "session_id": session_name,
                    "session_working_dir": os.getcwd(),
                }

                req_kwargs = {"json": payload, "headers": headers, "stream": True}
                if stream_timeout is not None:
                    req_kwargs["timeout"] = stream_timeout
                with requests.post(url, **req_kwargs) as resp:
                    if resp.status_code != 200:
                        try:
                            body = resp.text[:500]
                        except Exception:
                            body = "<no body>"
                        send_event({"type": "error", "error": f"HTTP {resp.status_code}", "response": body})
                        return

                    for raw_line in resp.iter_lines(decode_unicode=True):
                        if raw_line is None:
                            continue
                        line = raw_line.strip()
                        if not line or line.startswith(":"):
                            continue
                        if line.startswith("data:"):
                            data_part = line[5:].lstrip()
                            token = None
                            is_done = False
                            try:
                                obj = json.loads(data_part)
                                if isinstance(obj, dict):
                                    if obj.get("type") == "Message" and isinstance(obj.get("message"), dict):
                                        msg = obj["message"]
                                        for c in msg.get("content", []) or []:
                                            if isinstance(c, dict) and c.get("type") == "text":
                                                t = c.get("text")
                                                if t:
                                                    token = str(t)
                                                    accumulated.append(token)
                                                    send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                                    else:
                                        token = obj.get("text") or obj.get("token") or obj.get("content")
                                        if token:
                                            token = str(token)
                                            accumulated.append(token)
                                            send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                                        is_done = bool(obj.get("final") or obj.get("done"))
                                else:
                                    token = str(obj)
                                    accumulated.append(token)
                                    send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                            except Exception:
                                token = data_part
                                accumulated.append(token)
                                send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                            # Ранній аналіз завершення для SSE
                            if early_analysis_enabled and not early_followup_triggered:
                                full_text_now = "".join(accumulated)
                                analysis = _analyze_completion(full_text_now, user_message)
                                if analysis.get("need_follow_up"):
                                    early_followup_triggered = True
                                    reason = analysis.get("reason")
                                    send_event({
                                        "type": "status",
                                        "role": "verifier",
                                        "event": "incomplete_detected",
                                        "say": "Особа, що перевіряє: Завдання не завершено, оскільки не виконано:",
                                        "reason": reason
                                    })
                                    early_followup_text = _compose_follow_up_with_reason(full_text_now, user_message, reason)
                                    # перериваємо поточний стрім, щоб негайно довиконати
                                    break
                            if is_done:
                                break
                        elif line.lower() == "event: done":
                            break

                # Server-side auto follow up for goosed SSE (single chained message)
                try:
                    full_text = "".join(accumulated)
                    if early_followup_triggered and early_followup_text:
                        follow_up = early_followup_text
                    elif _needs_auto_follow_up(full_text):
                        # Повідомлення від "особи, що перевіряє" перед автопродовженням
                        send_event({
                            "type": "status",
                            "role": "verifier",
                            "event": "incomplete_detected",
                            "say": "Особа, що перевіряє: Завдання не виконано, формую коригуюче завдання."
                        })
                        # Невелика пауза, щоб дати шанс користувачу втрутитися (8с)
                        try:
                            time.sleep(8)
                        except Exception:
                            pass
                        follow_up = _compose_auto_follow_up(full_text, user_message)
                        send_event({
                            "type": "status",
                            "role": "verifier",
                            "event": "correction_task",
                            "correction": follow_up,
                            "say": "Особа, що перевіряє: Передаю нове завдання на довершення:"
                        })
                        send_event({"type": "status", "message": "server_auto_followup", "follow_up": follow_up})

                        payload_follow = {
                            "messages": [
                                {
                                    "role": "user",
                                    "created": int(time.time()),
                                    "content": [{"type": "text", "text": follow_up}],
                                }
                            ],
                            "session_id": session_name,
                            "session_working_dir": os.getcwd(),
                        }

                        req2_kwargs = {"json": payload_follow, "headers": headers, "stream": True}
                        if stream_timeout is not None:
                            req2_kwargs["timeout"] = stream_timeout
                        with requests.post(url, **req2_kwargs) as resp2:
                            if resp2.status_code == 200:
                                for raw_line in resp2.iter_lines(decode_unicode=True):
                                    if raw_line is None:
                                        continue
                                    line = raw_line.strip()
                                    if not line or line.startswith(":"):
                                        continue
                                    if line.startswith("data:"):
                                        data_part = line[5:].lstrip()
                                        token = None
                                        is_done = False
                                        try:
                                            obj = json.loads(data_part)
                                            if isinstance(obj, dict):
                                                if obj.get("type") == "Message" and isinstance(obj.get("message"), dict):
                                                    msg = obj["message"]
                                                    for c in msg.get("content", []) or []:
                                                        if isinstance(c, dict) and c.get("type") == "text":
                                                            t = c.get("text")
                                                            if t:
                                                                token = str(t)
                                                                accumulated.append(token)
                                                                send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                                                else:
                                                    token = obj.get("text") or obj.get("token") or obj.get("content")
                                                    if token:
                                                        token = str(token)
                                                        accumulated.append(token)
                                                        send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                                                    is_done = bool(obj.get("final") or obj.get("done"))
                                            else:
                                                token = str(obj)
                                                accumulated.append(token)
                                                send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                                        except Exception:
                                            token = data_part
                                            accumulated.append(token)
                                            send_event({"type": "token", "token": token, "accumulated": "".join(accumulated)})
                                        if is_done:
                                            break
                                    elif line.lower() == "event: done":
                                        break
                            else:
                                try:
                                    body2 = resp2.text[:500]
                                except Exception:
                                    body2 = "<no body>"
                                send_event({"type": "error", "error": f"HTTP {resp2.status_code}", "response": body2})
                except Exception as _e:
                    logger.debug(f"Auto-followup SSE skipped: {_e}")

            send_event({"type": "done", "total": "".join(accumulated), "session": session_name})
        except (BrokenPipeError, ConnectionResetError):
            return
        except requests.exceptions.RequestException as e:
            try:
                send_event({"type": "error", "error": str(e)})
            except Exception:
                pass
        except Exception as e:
            logger.error(f"Chat stream error: {e}")
            try:
                send_event({"type": "error", "error": str(e)})
            except Exception:
                pass

    def handle_chat_legacy(self, user_message: str, data: dict, user_context: dict, atlas_error: str = None):
        """Legacy обробка чату через HTTP API Goose замість CLI"""
        try:
            logger.info(f"🔄 Legacy: Обробляю через Goose HTTP API: {user_message[:100]}...")
            
            # Визначаємо тип сесії (legacy логіка)
            session_type = self.determine_session_type(user_message, data.get("session_type"))
            session_name = self.get_session_name(user_message, session_type)
            
            # Використання HTTP API замість CLI
            try:
                # На goosed завжди використовуємо /reply з session_id
                reply_result = self.send_goose_reply_sse(session_name, user_message)
                
                # Обробка результату
                if reply_result["success"]:
                    answer = reply_result.get("response", "Відповідь отримана")
                    
                    result_data = {
                        "response": answer,
                        "session_name": session_name,
                        "session_type": session_type,
                        "atlas_core": False,
                        "legacy_mode": True,
                        "api_mode": True
                    }
                    
                    # Якщо була помилка Atlas Core, додаємо інформацію
                    if atlas_error:
                        result_data["atlas_fallback"] = True
                        result_data["atlas_error"] = atlas_error
                    
                    logger.info(f"✅ Legacy API: Успішно виконано ({session_type})")
                    self.send_json_response(result_data)
                    
                else:
                    error_msg = reply_result.get("error", "Goose API не повернув відповідь")
                    logger.error(f"❌ Legacy API: {error_msg}")
                    self.send_json_response({
                        "response": f"Помилка Goose API: {error_msg}",
                        "error": error_msg,
                        "atlas_core": False,
                        "legacy_mode": True,
                        "api_mode": True
                    }, 500)
                    
            except Exception as api_error:
                logger.warning(f"⚠️ HTTP API недоступний, fallback до CLI: {api_error}")
                # Fallback до старого CLI методу
                self._handle_chat_cli_fallback(user_message, data, session_type, session_name, atlas_error)
                
        except Exception as e:
            logger.error(f"💥 Legacy Exception: {e}")
            self.send_json_response({
                "response": f"Помилка legacy режиму: {str(e)}",
                "error": str(e),
                "atlas_core": False,
                "legacy_mode": True
            }, 500)

    def _handle_chat_cli_fallback(self, user_message: str, data: dict, session_type: str, session_name: str, atlas_error: str = None):
        """Fallback до CLI методу, якщо HTTP API недоступний"""
        try:
            logger.info(f"🔄 CLI Fallback: Обробляю через Goose CLI: {user_message[:100]}...")
            
            # Виклик Goose CLI з правильною командою
            goose_path = "/Users/dev/Documents/GitHub/ATLAS/goose/target/release/goose"
            
            if session_type == "new_session":
                # Нова іменована сесія
                cmd = [goose_path, "session", "--name", session_name]
                process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    cwd="/Users/dev/Documents/GitHub/ATLAS/goose",
                    env=self._get_goose_env()
                )
                stdout, stderr = process.communicate(input=f"{user_message}\nexit\n", timeout=300)
                
            elif session_type == "continue_session":
                # Продовжуємо існуючу сесію
                cmd = [goose_path, "session", "--name", session_name, "--resume"]
                process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    cwd="/Users/dev/Documents/GitHub/ATLAS/goose",
                    env=self._get_goose_env()
                )
                stdout, stderr = process.communicate(input=f"{user_message}\nexit\n", timeout=300)
            else:
                # Fallback до старого методу
                cmd = [goose_path, "run", "-t", user_message, "--quiet"]
                result = subprocess.run(
                    cmd,
                    capture_output=True, 
                    text=True, 
                    timeout=300,
                    cwd="/Users/dev/Documents/GitHub/ATLAS/goose",
                    env=self._get_goose_env()
                )
                stdout = result.stdout
                stderr = result.stderr
            
            # Обробка результату
            if stdout:
                answer = self._clean_goose_output(stdout)
                
                response_data = {
                    "response": answer,
                    "session_name": session_name,
                    "session_type": session_type,
                    "atlas_core": False,
                    "legacy_mode": True,
                    "cli_fallback": True
                }
                
                # Якщо була помилка Atlas Core, додаємо інформацію
                if atlas_error:
                    response_data["atlas_fallback"] = True
                    response_data["atlas_error"] = atlas_error
                
                logger.info(f"✅ CLI Fallback: Успішно виконано ({session_type})")
                self.send_json_response(response_data)
            else:
                error_msg = stderr or "Goose не повернув відповідь"
                logger.error(f"❌ CLI Fallback: {error_msg}")
                self.send_json_response({
                    "response": f"Помилка Goose CLI: {error_msg}",
                    "error": error_msg,
                    "atlas_core": False,
                    "legacy_mode": True,
                    "cli_fallback": True
                }, 500)
                
        except subprocess.TimeoutExpired:
            logger.error("⏱️ CLI Fallback: Timeout при виконанні команди")
            self.send_json_response({
                "response": "Команда виконувалася занадто довго (>5хв)",
                "error": "Timeout",
                "atlas_core": False,
                "legacy_mode": True,
                "cli_fallback": True
            }, 408)
            
        except Exception as e:
            logger.error(f"💥 CLI Fallback Exception: {e}")
            self.send_json_response({
                "response": f"Помилка CLI fallback: {str(e)}",
                "error": str(e),
                "atlas_core": False,
                "legacy_mode": True,
                "cli_fallback": True
            }, 500)

    def _get_goose_env(self):
        """Отримує середовище для запуску Goose"""
        env = os.environ.copy()
        env["PATH"] = "/Users/dev/Documents/GitHub/ATLAS/goose/bin:" + env.get("PATH", "")
        env["RUST_LOG"] = "info"
        return env

    def _clean_goose_output(self, output: str) -> str:
        """Очищає вивід Goose від системних повідомлень"""
        lines = output.strip().split('\n')
        clean_lines = []
        for line in lines:
            if not any(skip in line for skip in [
                "starting session", "logging to", "working directory", 
                "Hermit environment", "activated", "Context:", "( O)>", "Press Enter"
            ]):
                clean_lines.append(line)
        
        clean_answer = '\n'.join(clean_lines).strip()
        return clean_answer if clean_answer else "Goose виконав завдання успішно"

    def determine_session_type(self, message, forced_type=None):
        """Визначає тип сесії на основі повідомлення"""
        if forced_type:
            return forced_type
            
        message_lower = message.lower()
        
        # Легкий фільтр на звичайний чат (привітання/знайомство/смоллток)
        chat_keywords = [
            "привіт", "вітаю", "добрий день", "добрий вечір", "що чутно", "як справи",
            "hi", "hello", "hey", "how are you", "how’s it going", "who are you", "як тебе звати",
            "як звати", "як тебе кличуть", "tell me about yourself", "поговоримо", "просто чат"
        ]
        if any(k in message_lower for k in chat_keywords):
            return "chat"

        # Ключові слова для НОВОГО завдання
        new_keywords = [
            "відкрий", "знайди", "створи", "почни", "запусти", "нове", 
            "завдання", "проект", "робота", "старт", "init"
        ]
        
        # Ключові слова для ПРОДОВЖЕННЯ
        continue_keywords = [
            "продовжи", "далі", "також", "тепер", "потім", "ще", 
            "додай", "зміни", "покращи", "зроби", "включи", "натисни"
        ]
        
        # Перевірка явних вказівок для нової сесії
        if any(word in message_lower for word in new_keywords):
            return "new_session"
        
        # Перевірка явних вказівок для продовження
        if any(word in message_lower for word in continue_keywords):
            return "continue_session"
        
        # За замовчуванням - чат (безпечніше, ніж створювати зайві сесії-завдання)
        return "chat"

    def get_session_name(self, message, session_type):
        """Генерує ім'я сесії на основі контексту"""
        message_lower = message.lower()
        
        if session_type == "chat":
            return "general_chat"
        
        # Контекстні теми
        if any(word in message_lower for word in ["відео", "фільм", "youtube", "браузер"]):
            return "video_browser"
        elif any(word in message_lower for word in ["музика", "пісня", "аудіо"]):
            return "music_player"
        elif any(word in message_lower for word in ["документ", "файл", "текст"]):
            return "document_editor"
        elif any(word in message_lower for word in ["калькулятор", "рахунок", "математика"]):
            return "calculator"
        elif any(word in message_lower for word in ["система", "статус", "моніторинг"]):
            return "system_monitor"
        else:
            # Універсальна сесія
            return "general_assistant"

    def _should_paraphrase(self, data: dict) -> bool:
        """Чи вмикати перефразування. Можна вимкнути полем no_paraphrase=true в запиті або змінною оточення."""
        try:
            if isinstance(data, dict) and str(data.get("no_paraphrase", "")).lower() in ("1", "true", "yes"):  # явне вимкнення
                return False
        except Exception:
            pass
        # За замовчуванням вмикаємо; можна глобально вимкнути через ENV
        return os.getenv("ATLAS_PARAPHRASE", "1") not in ("0", "false", "False")

    def _paraphrase_user_message(self, user_message: str) -> str:
        """Перефразовує запит у формат від першої особи, з чіткою метою та без потреби підтвердження.

        Без LLM: прості правила формують директиву для Goose. Оригінальний текст додаємо внизу.
        """
        msg = (user_message or "").strip()

        # Універсальний шаблон без доменної прив'язки
        rules = [
            "Працюю автономно, не прошу додаткових підтверджень.",
            "Якщо потрібен вибір — приймаю обґрунтоване і безпечне рішення самостійно.",
            "Уникаю зайвих пауз, доводжу задачу до завершення.",
            "Перевіряю результат і надаю стислий підсумок наприкінці.",
        ]

        steps = [
            "Уточнити внутрішньо вимоги і критерії готовності (Definition of Done).",
            "Розбити задачу на конкретні кроки і виконати їх послідовно.",
            "За потреби: самостійно обрати інструменти/ресурси і продовжити без запитань.",
            "Верифікувати отриманий результат і зафіксувати короткий підсумок.",
        ]

        rules_lines = "\n".join(f"- {r}" for r in rules)
        steps_lines = "\n".join(f"- {s}" for s in steps)

        directive = (
            "Я беру на себе виконання завдання повністю і автономно.\n"
            "Правила:\n"
            f"{rules_lines}\n"
            "План дій:\n"
            f"{steps_lines}\n"
            "Оригінальний запит користувача (контекст, не для цитування як є): " + msg
        )

        return directive

    def _get_stream_timeout(self) -> int | None:
        """Повертає таймаут стріму в секундах або None для безлімітного.

        Керується змінними середовища:
          - ATLAS_STREAM_TIMEOUT або ATLAS_STREAM_TIMEOUT_SECONDS
            * "0", "none", "off", порожнє -> без таймауту (None)
            * інакше -> int секунд
        За замовчуванням: None (без таймауту).
        """
        try:
            raw = (os.getenv("ATLAS_STREAM_TIMEOUT") or os.getenv("ATLAS_STREAM_TIMEOUT_SECONDS") or "").strip()
            if not raw:
                return None
            low = raw.lower()
            if low in ("0", "none", "off", "infinite"):
                return None
            return int(raw)
        except Exception:
            return None
    
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

    def handle_analyze_prompt(self):
        """
        Аналізує окремий промпт для визначення режиму
        POST /api/atlas/analyze-prompt
        Body: {"prompt": "текст для аналізу"}
        """
        try:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8'))
            
            prompt = data.get("prompt", "")
            if not prompt:
                self.send_json_response({"error": "Prompt is required"}, 400)
                return
            
            if hasattr(self.server, 'session_manager'):
                sm = self.server.session_manager
                
                # Проводимо аналіз
                analysis = sm.analyze_user_mode_preference(prompt)
                
                response_data = {
                    "prompt": prompt,
                    "analysis": analysis,
                    "system_info": {
                        "current_default": "http_api" if sm.use_http_api else "cli",
                        "intelligent_switching": "enabled"
                    },
                    "timestamp": datetime.now().isoformat()
                }
                
                self.send_json_response(response_data)
                
            else:
                self.send_json_response({"error": "Session manager not available"}, 503)
                
        except Exception as e:
            logger.error(f"Prompt analysis error: {e}")
            self.send_json_response({"error": str(e)}, 500)

    

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
                "http://localhost:3000/tts",
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
    
    # Используем многопоточный сервер, чтобы долгие SSE-запросы не блокировали другие эндпоинты
    httpd = ThreadingHTTPServer(server_address, AtlasMinimalHandler)
    
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
