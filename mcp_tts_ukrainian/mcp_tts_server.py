#!/usr/bin/env python3
"""
Ukrainian TTS MCP Server
=========================

Надає TTS (Text-to-Speech) можливості з підтримкою української мови:
- Основний движок: robinhad/ukrainian-tts
- Fallback: Google TTS (gTTS)
- Підтримка MCP протоколу

Автор: Atlas AI Team
"""

import asyncio
import io
import json
import logging
import os
import sys
import tempfile
import traceback
from pathlib import Path
from typing import Dict, Any, Optional

import pygame
import requests
from gtts import gTTS

# Налаштування логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class UkrainianTTSEngine:
    """Движок для української TTS з підтримкою fallback на Google TTS"""
    
    def __init__(self):
        self.ukrainian_tts = None
        self.pygame_initialized = False
        self._init_ukrainian_tts()
        self._init_pygame()
    
    def _init_ukrainian_tts(self):
        """Ініціалізація українського TTS"""
        try:
            # Спробуємо різні варіанти ініціалізації
            logger.info("Trying Ukrainian TTS initialization...")
            
            # Варіант 1: Сучасний API з TTS класом
            try:
                from ukrainian_tts.tts import TTS
                self.ukrainian_tts = TTS(device='cpu')
                self.voices = None  # Не використовуємо Voices enum через помилки
                logger.info("✅ Ukrainian TTS (modern API) initialized successfully")
                return
            except Exception as e1:
                logger.debug(f"Modern API failed: {e1}")
            
            # Варіант 2: Прямий імпорт функцій
            try:
                from ukrainian_tts import tts as ukrainian_tts_func
                self.ukrainian_tts_func = ukrainian_tts_func
                self.ukrainian_tts = True  # Флаг що система доступна
                self.voices = None
                logger.info("✅ Ukrainian TTS (function API) initialized successfully")
                return
            except Exception as e2:
                logger.debug(f"Function API failed: {e2}")
                
            # Варіант 3: Модульний імпорт
            try:
                import ukrainian_tts
                self.ukrainian_tts_module = ukrainian_tts
                self.ukrainian_tts = True
                self.voices = None
                logger.info("✅ Ukrainian TTS (module API) initialized successfully")
                return
            except Exception as e3:
                logger.debug(f"Module API failed: {e3}")
            
            # Якщо всі варіанти не спрацювали
            raise Exception("All Ukrainian TTS initialization methods failed")
            
        except Exception as e:
            logger.warning(f"⚠️ Ukrainian TTS initialization failed: {e}")
            self.ukrainian_tts = None
            self.ukrainian_tts_func = None
            self.ukrainian_tts_module = None
            self.voices = None
    
    def _init_pygame(self):
        """Ініціалізація pygame для відтворення звуку"""
        try:
            pygame.mixer.init()
            self.pygame_initialized = True
            logger.info("✅ Pygame audio initialized")
        except Exception as e:
            logger.warning(f"⚠️ Pygame initialization failed: {e}")
            self.pygame_initialized = False
    
    async def speak_ukrainian(self, text: str, voice: str = "mykyta") -> bool:
        """
        Озвучування тексту українською TTS
        
        Args:
            text: Текст для озвучування
            voice: Голос (mykyta, oleksa, tetiana, lada)
        
        Returns:
            bool: True якщо успішно, False якщо помилка
        """
        if not self.ukrainian_tts:
            logger.warning("Ukrainian TTS not available, falling back to Google TTS")
            return await self.speak_google(text, lang='uk')
        
        try:
            # Створення тимчасового файлу
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as temp_file:
                temp_path = temp_file.name
            
            # Генерація через ukrainian-tts з правильними параметрами
            logger.info(f"🎙️ Generating speech with voice: {voice}")
            
            try:
                # Перевіряємо який тип API доступний
                if hasattr(self, 'ukrainian_tts_func'):
                    # Функціональний API
                    logger.debug("Using functional API")
                    with open(temp_path, 'wb') as output_file:
                        self.ukrainian_tts_func(text, voice, output_file)
                        
                elif hasattr(self, 'ukrainian_tts_module'):
                    # Модульний API  
                    logger.debug("Using module API")
                    with open(temp_path, 'wb') as output_file:
                        self.ukrainian_tts_module.tts(text, voice, output_file)
                        
                elif hasattr(self.ukrainian_tts, 'tts'):
                    # Сучасний API (з TTS класом)
                    logger.debug("Using class API")
                    with open(temp_path, 'wb') as output_file:
                        # Спробуємо різні варіанти параметрів
                        try:
                            # Спочатку спробуємо з stress="dictionary"
                            self.ukrainian_tts.tts(text, voice, "dictionary", output_file)
                        except Exception as e:
                            logger.debug(f"Dictionary stress failed: {e}")
                            try:
                                # Спробуємо з stress="model"
                                self.ukrainian_tts.tts(text, voice, "model", output_file)
                            except Exception as e2:
                                logger.debug(f"Model stress failed: {e2}")
                                # Спробуємо без stress параметра
                                self.ukrainian_tts.tts(text, voice, output_file)
                            
                elif hasattr(self.ukrainian_tts, 'inference'):
                    # Використання inference методу
                    logger.debug("Using inference API")
                    audio = self.ukrainian_tts.inference(text, voice=voice)
                    # Збереження аудіо у файл
                    import torchaudio
                    torchaudio.save(temp_path, audio, 22050)
                else:
                    # Fallback до Google TTS
                    logger.warning("Ukrainian TTS API incompatible, using Google TTS")
                    return await self.speak_google(text, lang='uk')
            
            except Exception as api_error:
                logger.warning(f"Ukrainian TTS API error: {api_error}, trying fallback")
                return await self.speak_google(text, lang='uk')
            
            # Перевірка, чи файл створено
            if not Path(temp_path).exists() or Path(temp_path).stat().st_size == 0:
                logger.warning("Ukrainian TTS produced empty file, using Google TTS")
                return await self.speak_google(text, lang='uk')
            
            # Відтворення
            if self.pygame_initialized:
                pygame.mixer.music.load(temp_path)
                pygame.mixer.music.play()
                
                # Чекаємо закінчення відтворення
                while pygame.mixer.music.get_busy():
                    await asyncio.sleep(0.1)
            
            # Очищення тимчасового файлу
            Path(temp_path).unlink(missing_ok=True)
            
            logger.info("✅ Ukrainian TTS playback completed")
            return True
            
        except Exception as e:
            logger.error(f"❌ Ukrainian TTS failed: {e}")
            # Очищення файлу у разі помилки
            try:
                Path(temp_path).unlink(missing_ok=True)
            except:
                pass
            return await self.speak_google(text, lang='uk')
    
    async def speak_google(self, text: str, lang: str = 'uk') -> bool:
        """
        Fallback озвучування через Google TTS
        
        Args:
            text: Текст для озвучування
            lang: Мова (uk, en, ru)
        
        Returns:
            bool: True якщо успішно, False якщо помилка
        """
        try:
            logger.info(f"🌐 Using Google TTS fallback for: {text[:50]}...")
            
            # Генерація через gTTS
            tts = gTTS(text=text, lang=lang, slow=False)
            
            with tempfile.NamedTemporaryFile(suffix='.mp3', delete=False) as temp_file:
                temp_path = temp_file.name
            
            tts.save(temp_path)
            
            # Відтворення
            if self.pygame_initialized:
                pygame.mixer.music.load(temp_path)
                pygame.mixer.music.play()
                
                # Чекаємо закінчення відтворення
                while pygame.mixer.music.get_busy():
                    await asyncio.sleep(0.1)
            
            # Очищення
            Path(temp_path).unlink(missing_ok=True)
            
            logger.info("✅ Google TTS playback completed")
            return True
            
        except Exception as e:
            logger.error(f"❌ Google TTS failed: {e}")
            return False
    
    async def speak(self, text: str, voice: str = "mykyta", lang: str = "uk") -> Dict[str, Any]:
        """
        Головний метод для озвучування
        
        Args:
            text: Текст для озвучування
            voice: Голос для українського TTS
            lang: Мова (uk, en, ru)
        
        Returns:
            Dict з результатом операції
        """
        if not text.strip():
            return {"status": "error", "message": "Empty text provided"}
        
        try:
            # Спробувати українську TTS для української мови
            if lang == 'uk':
                success = await self.speak_ukrainian(text, voice)
            else:
                # Для інших мов використовувати Google TTS
                success = await self.speak_google(text, lang)
            
            if success:
                return {
                    "status": "success", 
                    "message": f"Successfully spoke: {text[:50]}{'...' if len(text) > 50 else ''}",
                    "engine": "ukrainian-tts" if lang == 'uk' and self.ukrainian_tts else "google-tts",
                    "voice": voice if lang == 'uk' else "default",
                    "language": lang
                }
            else:
                return {
                    "status": "error", 
                    "message": "All TTS engines failed",
                    "text": text[:100]
                }
                
        except Exception as e:
            logger.error(f"TTS speak error: {e}")
            return {
                "status": "error", 
                "message": str(e),
                "text": text[:100]
            }


class MCPTTSServer:
    """MCP сервер для українського TTS"""
    
    def __init__(self):
        self.tts_engine = UkrainianTTSEngine()
        logger.info("🎙️ Ukrainian TTS MCP Server initialized")
    
    def get_available_tools(self) -> Dict[str, Any]:
        """Отримання списку доступних інструментів"""
        return {
            "tools": {
                "say_tts": {
                    "description": "Text-to-speech using Ukrainian TTS with Google TTS fallback",
                    "parameters": {
                        "text": {"type": "string", "description": "Text to speak"},
                        "voice": {
                            "type": "string", 
                            "description": "Voice for Ukrainian TTS", 
                            "enum": ["mykyta", "oleksa", "tetiana", "lada"],
                            "default": "mykyta"
                        },
                        "lang": {
                            "type": "string",
                            "description": "Language code",
                            "enum": ["uk", "en", "ru"],
                            "default": "uk"
                        },
                        "rate": {"type": "number", "description": "Speech rate (ignored, for compatibility)", "default": 200}
                    },
                    "required": ["text"]
                },
                "list_voices": {
                    "description": "List available voices",
                    "parameters": {},
                    "required": []
                },
                "tts_status": {
                    "description": "Get TTS engine status",
                    "parameters": {},
                    "required": []
                }
            }
        }
    
    def call_tool_sync(self, tool_name: str, args: Dict[str, Any]) -> str:
        """Синхронна версія call_tool для виклику з Rust"""
        try:
            # Запускаємо async метод в новому event loop
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result = loop.run_until_complete(self.call_tool(tool_name, args))
                return json.dumps(result, ensure_ascii=False)
            finally:
                loop.close()
        except Exception as e:
            logger.error(f"Error in call_tool_sync: {e}")
            return json.dumps({"status": "error", "message": f"Sync call error: {str(e)}"}, ensure_ascii=False)

    async def call_tool(self, tool_name: str, args: Dict[str, Any]) -> Dict[str, Any]:
        """Виклик інструменту"""
        try:
            if tool_name == "say_tts":
                text = args.get("text", "")
                voice = args.get("voice", "mykyta")
                lang = args.get("lang", "uk")
                
                return await self.tts_engine.speak(text, voice, lang)
            
            elif tool_name == "list_voices":
                return {
                    "status": "success",
                    "voices": {
                        "ukrainian": ["mykyta", "oleksa", "tetiana", "lada"],
                        "google": ["default (per language)"]
                    },
                    "languages": ["uk", "en", "ru"]
                }
            
            elif tool_name == "tts_status":
                return {
                    "status": "success",
                    "engines": {
                        "ukrainian_tts": self.tts_engine.ukrainian_tts is not None,
                        "google_tts": True,
                        "pygame_audio": self.tts_engine.pygame_initialized
                    },
                    "primary_engine": "ukrainian-tts" if self.tts_engine.ukrainian_tts else "google-tts"
                }
            
            else:
                return {
                    "status": "error",
                    "message": f"Unknown tool: {tool_name}"
                }
                
        except Exception as e:
            logger.error(f"Tool call error: {e}")
            return {
                "status": "error",
                "message": str(e),
                "traceback": traceback.format_exc()
            }


async def main():
    """Головна функція MCP сервера"""
    server = MCPTTSServer()
    
    logger.info("🚀 Starting Ukrainian TTS MCP Server...")
    
    # MCP протокол через stdin/stdout
    while True:
        try:
            # Читання запиту з stdin
            line = sys.stdin.readline()
            if not line:
                break
            
            request = json.loads(line.strip())
            
            # Обробка запиту
            if request.get("method") == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "result": server.get_available_tools()
                }
            
            elif request.get("method") == "tools/call":
                params = request.get("params", {})
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                result = await server.call_tool(tool_name, args)
                
                response = {
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
                response = {
                    "jsonrpc": "2.0",
                    "id": request.get("id"),
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {request.get('method')}"
                    }
                }
            
            # Відправка відповіді
            print(json.dumps(response, ensure_ascii=False))
            sys.stdout.flush()
            
        except EOFError:
            break
        except Exception as e:
            logger.error(f"Main loop error: {e}")
            error_response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if 'request' in locals() else None,
                "error": {
                    "code": -32603,
                    "message": str(e)
                }
            }
            print(json.dumps(error_response))
            sys.stdout.flush()

if __name__ == "__main__":
    asyncio.run(main())
