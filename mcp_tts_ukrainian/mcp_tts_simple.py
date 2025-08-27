#!/usr/bin/env python3
"""
Simplified Ukrainian TTS MCP Server for Goose
===========================================

Спрощена версія MCP сервера для стабільної роботи з Goose
"""

import asyncio
import json
import logging
import sys
import tempfile
from pathlib import Path
import traceback

# Мінімальний набір імпортів
try:
    import pygame
    PYGAME_AVAILABLE = True
except ImportError:
    PYGAME_AVAILABLE = False
    
try:
    from gtts import gTTS
    GTTS_AVAILABLE = True
except ImportError:
    GTTS_AVAILABLE = False

try:
    from ukrainian_tts.tts import TTS
    UKRAINIAN_TTS_AVAILABLE = True
except ImportError:
    UKRAINIAN_TTS_AVAILABLE = False

# Налаштування логування
logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
logger = logging.getLogger(__name__)

class SimpleTTSEngine:
    """Спрощений TTS движок"""
    
    def __init__(self):
        self.ukrainian_tts = None
        self.pygame_ready = False
        self._init_components()
    
    def _init_components(self):
        """Ініціалізація компонентів"""
        # Ukrainian TTS
        if UKRAINIAN_TTS_AVAILABLE:
            try:
                self.ukrainian_tts = TTS(device='cpu')
                logger.info("Ukrainian TTS loaded")
            except Exception as e:
                logger.warning(f"Ukrainian TTS failed: {e}")
        
        # Pygame
        if PYGAME_AVAILABLE:
            try:
                pygame.mixer.init()
                self.pygame_ready = True
                logger.info("Pygame ready")
            except Exception as e:
                logger.warning(f"Pygame failed: {e}")
    
    async def speak(self, text: str, voice: str = "mykyta", lang: str = "uk") -> dict:
        """Озвучення тексту"""
        if not text.strip():
            return {"status": "error", "message": "Empty text"}
        
        try:
            # Вибір движка
            if lang == "uk" and self.ukrainian_tts:
                return await self._speak_ukrainian(text, voice)
            elif GTTS_AVAILABLE:
                return await self._speak_google(text, lang)
            else:
                return {"status": "error", "message": "No TTS engines available"}
        
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    async def _speak_ukrainian(self, text: str, voice: str) -> dict:
        """Ukrainian TTS"""
        try:
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                temp_path = f.name
            
            # Генерація
            with open(temp_path, 'wb') as output_file:
                self.ukrainian_tts.tts(text, voice, "dictionary", output_file)
            
            # Відтворення
            if self.pygame_ready and Path(temp_path).exists():
                pygame.mixer.music.load(temp_path)
                pygame.mixer.music.play()
                
                while pygame.mixer.music.get_busy():
                    await asyncio.sleep(0.1)
            
            # Очищення
            Path(temp_path).unlink(missing_ok=True)
            
            return {"status": "success", "engine": "ukrainian-tts", "text": text[:50]}
        
        except Exception as e:
            return {"status": "error", "message": f"Ukrainian TTS error: {e}"}
    
    async def _speak_google(self, text: str, lang: str) -> dict:
        """Google TTS"""
        try:
            tts = gTTS(text=text, lang=lang, slow=False)
            
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as f:
                temp_path = f.name
            
            tts.save(temp_path)
            
            # Відтворення
            if self.pygame_ready and Path(temp_path).exists():
                pygame.mixer.music.load(temp_path)
                pygame.mixer.music.play()
                
                while pygame.mixer.music.get_busy():
                    await asyncio.sleep(0.1)
            
            # Очищення
            Path(temp_path).unlink(missing_ok=True)
            
            return {"status": "success", "engine": "google-tts", "text": text[:50]}
        
        except Exception as e:
            return {"status": "error", "message": f"Google TTS error: {e}"}

# Глобальний движок
tts_engine = SimpleTTSEngine()

async def handle_request(request):
    """Обробка MCP запиту"""
    try:
        method = request.get("method")
        
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {
                        "tools": {}
                    },
                    "serverInfo": {
                        "name": "ukrainian-tts",
                        "version": "1.0.0"
                    }
                }
            }
        
        elif method == "tools/list":
            return {
                "jsonrpc": "2.0",
                "id": request.get("id"),
                "result": {
                    "tools": [
                        {
                            "name": "say_tts",
                            "description": "Text-to-speech with Ukrainian and Google TTS",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "text": {"type": "string", "description": "Text to speak"},
                                    "voice": {"type": "string", "description": "Voice name"},
                                    "lang": {"type": "string", "description": "Language code"}
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
            
            if tool_name == "say_tts":
                result = await tts_engine.speak(
                    args.get("text", ""),
                    args.get("voice", "mykyta"),
                    args.get("lang", "uk")
                )
                
                return {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": json.dumps(result, ensure_ascii=False)
                            }
                        ]
                    }
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
        logger.error(f"Request error: {e}")
        return {
            "jsonrpc": "2.0",
            "id": request.get("id", None),
            "error": {"code": -32603, "message": str(e)}
        }

async def main():
    """Головний цикл MCP сервера"""
    logger.info("Starting Simple Ukrainian TTS MCP Server")
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
            
            request = json.loads(line.strip())
            response = await handle_request(request)
            
            print(json.dumps(response, ensure_ascii=False))
            sys.stdout.flush()
        
        except EOFError:
            break
        except Exception as e:
            logger.error(f"Main loop error: {e}")
            error_response = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32603, "message": str(e)}
            }
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    asyncio.run(main())
