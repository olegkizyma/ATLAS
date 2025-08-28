#!/usr/bin/env python3
"""
Fixed Ukrainian TTS MCP Server for Goose
========================================

Виправлена версія MCP сервера з покращеною обробкою помилок
"""

import asyncio
import json
import logging
import sys
import tempfile
import signal
from pathlib import Path
import traceback
import os

# Налаштування логування тільки для критичних помилок
logging.basicConfig(level=logging.ERROR, stream=sys.stderr, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

# Глобальна змінна для швидкого завершення
shutdown_flag = False

def signal_handler(signum, frame):
    global shutdown_flag
    shutdown_flag = True
    sys.exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

class FixedTTSEngine:
    """Виправлений TTS движок з кращою стабільністю"""
    
    def __init__(self):
        self.ukrainian_tts = None
        self.pygame_ready = False
        self.gtts_available = False
        self._init_safely()
    
    def _init_safely(self):
        """Безпечна ініціалізація з обробкою помилок.
        ВАЖЛИВО: не імпортуємо/не ініціалізуємо pygame на старті, щоб
        уникнути будь-якого виводу у stdout до відповіді MCP initialize.
        """
        # Приховуємо повідомлення pygame, якщо воно буде імпортоване пізніше
        os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
        self.pygame_ready = False

        try:
            # Перевірка gTTS
            from gtts import gTTS
            self.gtts_available = True
        except ImportError:
            self.gtts_available = False
        
        # Ukrainian TTS ініціалізуємо лише при першому використанні
        # щоб прискорити запуск сервера
    
    def _init_ukrainian_tts(self):
        """Лінива ініціалізація Ukrainian TTS"""
        if self.ukrainian_tts is not None:
            return True
            
        try:
            from ukrainian_tts.tts import TTS
            # Ініціалізація без параметрів - stress буде передано в tts() методі
            self.ukrainian_tts = TTS()
            return True
        except Exception as e:
            logger.error(f"Ukrainian TTS init failed: {e}")
            return False
    
    def _init_pygame(self):
        """Ініціалізація pygame для відтворення аудіо"""
        try:
            import pygame
            pygame.mixer.pre_init(frequency=22050, size=-16, channels=2, buffer=512)
            pygame.mixer.init()
            self.pygame_ready = True
        except Exception as e:
            logger.error(f"Pygame init failed: {e}")
            self.pygame_ready = False
    
    async def speak(self, text: str, voice: str = "mykyta", lang: str = "uk"):
        """Озвучка тексту з fallback варіантами"""
        if not text or not text.strip():
            return {"success": False, "error": "Empty text"}
        
        text = text.strip()
        
        # Спроба 1: Ukrainian TTS для української мови
        if lang == "uk":
            try:
                if self._init_ukrainian_tts():
                    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_file:
                        # Правильний виклик: text, voice, stress, output_file_object
                        self.ukrainian_tts.tts(text, voice, "dictionary", tmp_file)
                        tmp_file.flush()  # Забезпечення запису на диск
                        # Ініціалізуємо pygame перед відтворенням
                        if not self.pygame_ready:
                            self._init_pygame()
                        if self.pygame_ready:
                            await self._play_audio_async(tmp_file.name)
                        Path(tmp_file.name).unlink(missing_ok=True)
                        return {"success": True, "engine": "ukrainian-tts", "voice": voice}
            except Exception as e:
                logger.error(f"Ukrainian TTS error: {e}")
        
        # Спроба 2: Google TTS як fallback
        if self.gtts_available:
            try:
                from gtts import gTTS
                tts_lang = "uk" if lang == "uk" else "en"
                tts = gTTS(text=text, lang=tts_lang, slow=False)
                
                with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp_file:
                    tts.save(tmp_file.name)
                    if self.pygame_ready:
                        await self._play_audio_async(tmp_file.name)
                        Path(tmp_file.name).unlink(missing_ok=True)
                        return {"success": True, "engine": "gtts", "lang": tts_lang}
            except Exception as e:
                logger.error(f"Google TTS error: {e}")
        
        # Якщо все не вдалося
        return {
            "success": False, 
            "error": "All TTS engines failed",
            "text": text[:50] + "..." if len(text) > 50 else text
        }
    
    async def _play_audio_async(self, file_path: str):
        """Асинхронне відтворення аудіо"""
        try:
            # Ініціалізуємо pygame ліниво і без виводу
            os.environ.setdefault("PYGAME_HIDE_SUPPORT_PROMPT", "1")
            import pygame
            if not self.pygame_ready:
                try:
                    pygame.mixer.pre_init(frequency=22050, size=-16, channels=2, buffer=512)
                    pygame.mixer.init()
                    self.pygame_ready = True
                except Exception as init_err:
                    logger.error(f"Pygame init failed: {init_err}")
                    return
            pygame.mixer.music.load(file_path)
            pygame.mixer.music.play()
            
            # Чекаємо завершення відтворення, але не більше 30 секунд
            timeout = 30
            while pygame.mixer.music.get_busy() and timeout > 0:
                await asyncio.sleep(0.1)
                timeout -= 0.1
                
            pygame.mixer.music.stop()
        except Exception as e:
            logger.error(f"Audio playback error: {e}")

# Глобальний екземпляр TTS движка
tts_engine = FixedTTSEngine()

class MCPTTSServer:
    """Клас-обгортка для сумісності з Rust кодом"""
    
    def __init__(self):
        self.tts_engine = tts_engine
    
    def call_tool_sync(self, tool_name, args):
        """Синхронний виклик TTS з обробкою у стилі MCP"""
        if tool_name == "say_tts":
            text = args.get("text", "")
            voice = args.get("voice", "tetiana") 
            lang = args.get("lang", "uk")
            
            # Запускаємо асинхронний метод через новий event loop
            try:
                result = asyncio.run(self.tts_engine.speak(text, voice, lang))
                return json.dumps(result, ensure_ascii=False, indent=2)
            except Exception as e:
                return json.dumps({"success": False, "error": str(e)})
        
        elif tool_name == "list_voices":
            voices = {
                "ukrainian_voices": ["tetiana", "mykyta", "oleksa", "lada"],
                "supported_languages": ["uk", "en"],
                "default": "tetiana"
            }
            return json.dumps(voices, ensure_ascii=False, indent=2)
        
        elif tool_name == "tts_status":
            status = {
                "engine": "ukrainian-tts",
                "pygame_ready": self.tts_engine.pygame_ready,
                "ukrainian_tts_loaded": self.tts_engine.ukrainian_tts is not None,
                "fallback_disabled": True
            }
            return json.dumps(status, ensure_ascii=False, indent=2)
        
        else:
            return json.dumps({"error": f"Unknown tool: {tool_name}"})

# Aliases для сумісності
TTSServer = MCPTTSServer
UkrainianTTSServer = MCPTTSServer

async def handle_request(request):
    """Обробка MCP запитів з таймаутом"""
    if shutdown_flag:
        return {"jsonrpc": "2.0", "error": {"code": -32000, "message": "Server shutting down"}}
    
    try:
        method = request.get("method")
        
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {
                        "name": "ukrainian-tts-fixed",
                        "version": "1.1.0"
                    }
                }
            }
        
        elif method == "notifications/initialized":
            return None  # Не потребує відповіді
        
        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "result": {
                    "tools": [
                        {
                            "name": "ukrainian_tts",
                            "description": "Ukrainian text-to-speech with Google TTS fallback. Supports Ukrainian and English text.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": {
                                        "type": "string", 
                                        "description": "Text to speak (Ukrainian or English)"
                                    },
                                    "voice": {
                                        "type": "string", 
                                        "description": "Voice for Ukrainian TTS (mykyta, oleksandr, lada, etc.)",
                                        "default": "mykyta"
                                    },
                                    "lang": {
                                        "type": "string", 
                                        "description": "Language code (uk for Ukrainian, en for English)",
                                        "default": "uk"
                                    }
                                },
                                "required": ["text"]
                            }
                        }
                    ]
                }
            }
        
        elif method == "tools/call":
            params = request.get("params", {})
            tool_name = params.get("name")
            args = params.get("arguments", {})
            
            if tool_name == "ukrainian_tts":
                # Додаємо таймаут для TTS операції
                try:
                    result = await asyncio.wait_for(
                        tts_engine.speak(
                            args.get("text", ""),
                            args.get("voice", "mykyta"),
                            args.get("lang", "uk")
                        ),
                        timeout=30.0  # 30 секунд таймаут
                    )
                    
                    return {
                        "jsonrpc": "2.0",
                        "id": request.get("id"),
                        "result": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": json.dumps(result, ensure_ascii=False, indent=2)
                                }
                            ]
                        }
                    }
                except asyncio.TimeoutError:
                    return {
                        "jsonrpc": "2.0",
                        "id": request.get("id"),
                        "error": {"code": -32603, "message": "TTS operation timed out"}
                    }
            else:
                return {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "error": {"code": -32601, "message": f"Unknown tool: {tool_name}"}
                }
        
        else:
            return {
                "jsonrpc": "2.0", 
                "id": request.get("id"),
                "error": {"code": -32601, "message": f"Unknown method: {method}"}
            }
    
    except Exception as e:
        error_msg = f"Request error: {str(e)}"
        logger.error(error_msg)
        return {
            "jsonrpc": "2.0",
            "id": request.get("id", None),
            "error": {"code": -32603, "message": error_msg}
        }

async def main():
    """Головний цикл MCP сервера з покращеною стабільністю"""
    try:
        # Швидке підтвердження готовності
        sys.stderr.write("Fixed Ukrainian TTS MCP Server starting...\n")
        sys.stderr.flush()
        
        while not shutdown_flag:
            try:
                # Читання з stdin з таймаутом
                line = await asyncio.wait_for(
                    asyncio.get_event_loop().run_in_executor(None, sys.stdin.readline),
                    timeout=1.0
                )
                
                if not line:
                    break
                
                line = line.strip()
                if not line:
                    continue
                
                request = json.loads(line)
                response = await handle_request(request)
                
                if response is not None:
                    print(json.dumps(response, ensure_ascii=False))
                    sys.stdout.flush()
            
            except asyncio.TimeoutError:
                # Таймаут читання - це нормально, продовжуємо
                continue
            except EOFError:
                break
            except json.JSONDecodeError as e:
                error_response = {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32700, "message": f"Parse error: {str(e)}"}
                }
                print(json.dumps(error_response))
                sys.stdout.flush()
            except Exception as e:
                logger.error(f"Main loop error: {e}")
                error_response = {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32603, "message": str(e)}
                }
                print(json.dumps(error_response))
                sys.stdout.flush()
    
    except KeyboardInterrupt:
        pass
    except Exception as e:
        logger.error(f"Fatal error: {e}")
    finally:
        sys.stderr.write("Ukrainian TTS MCP Server stopped.\n")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
