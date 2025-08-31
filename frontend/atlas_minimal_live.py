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
from services.goose_client import GooseClient
from services import config as cfg
from services.log_streamer import LiveLogStreamer
from services.utils.session import determine_session_type as util_determine_session_type, get_session_name as util_get_session_name
from services.handlers import assets as h_assets
from services.handlers import logs as h_logs
from services.handlers import status as h_status
from services.handlers import chat as h_chat
from services.handlers import tts as h_tts
from services.handlers import atlas as h_atlas

# Налаштування логування
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Використовуємо LiveLogStreamer з services.log_streamer без перевизначення

class AtlasMinimalHandler(SimpleHTTPRequestHandler):
    """Обробник запитів для Atlas Minimal Interface"""

    def __init__(self, *args, **kwargs):
        # Нова конфігурація Goose через клієнт сервісного шару
        # Централізуємо базовий URL та секрет через services.config
        self.goose_client = GooseClient(base_url=cfg.goose_base_url(), secret_key=cfg.goose_secret_key("test"))
        self.goose_api_url = self.goose_client.base_url
        # Проксі прапор наявності Atlas Core для зовнішніх хендлерів
        try:
            self.ATLAS_CORE_AVAILABLE = ATLAS_CORE_AVAILABLE
        except NameError:
            self.ATLAS_CORE_AVAILABLE = False
        # Лог-стрімер може бути ініціалізований пізніше; зберігаємо посилання
        self.live_streamer = None
        super().__init__(*args, **kwargs)

    def do_OPTIONS(self):
        """Обробка preflight CORS запитів"""
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')

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
        """Delegated streaming chat endpoint."""
        return h_chat.handle_chat_stream(self)

    def handle_chat_legacy(self, user_message: str, data: dict, user_context: dict, atlas_error: str = None):
        """Legacy обробка чату через HTTP API Goose замість CLI"""
        try:
            logger.info(f"🔄 Legacy: Обробляю через Goose HTTP API: {user_message[:100]}...")
            
            # Визначаємо тип сесії (legacy логіка)
            session_type = util_determine_session_type(user_message, data.get("session_type"))
            session_name = util_get_session_name(user_message, session_type)
            
            # Використання HTTP API замість CLI
            try:
                # На goosed завжди використовуємо /reply з session_id
                reply_result = self.goose_client.send_reply(session_name, user_message)
                
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
    # Даём возможность задать порт через ENV и избегаем конфликта, если порт занят
    try:
        port = int(os.getenv("ATLAS_PORT", "8080"))
    except Exception:
        port = 8080
    server_address = ('', port)
    
    # Зміна робочої директорії
    os.chdir(Path(__file__).parent)
    
    # Используем многопоточный сервер, чтобы долгие SSE-запросы не блокировали другие эндпоинты
    # Пробуем занять порт, при ошибке ищем следующий свободный
    try:
        httpd = ThreadingHTTPServer(server_address, AtlasMinimalHandler)
    except OSError:
        # Поиск свободного порта
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("", 0))
            free_port = s.getsockname()[1]
        port = free_port
        server_address = ('', port)
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

