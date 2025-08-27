#!/usr/bin/env python3
"""
Goose AI Integration для Ukrainian TTS
====================================

Інтеграція Ukrainian TTS MCP Server з Goose AI
"""

import asyncio
import json
import logging
from mcp_tts_server import MCPTTSServer

# Налаштування логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class GooseUkrainianTTS:
    """Інтеграція Ukrainian TTS для Goose AI"""
    
    def __init__(self):
        self.server = MCPTTSServer()
        logger.info("🎙️ Goose Ukrainian TTS Integration initialized")
    
    async def speak(self, text: str, voice: str = "mykyta", lang: str = "uk") -> bool:
        """
        Озвучення тексту для Goose AI
        
        Args:
            text: Текст для озвучування
            voice: Голос (mykyta, oleksa, tetiana, lada)
            lang: Мова (uk, en, ru)
            
        Returns:
            bool: True якщо успішно, False якщо помилка
        """
        try:
            result = await self.server.call_tool("say_tts", {
                "text": text,
                "voice": voice,
                "lang": lang
            })
            
            if result["status"] == "success":
                logger.info(f"🎵 Spoke: {text[:50]}... ({result['engine']})")
                return True
            else:
                logger.error(f"❌ TTS failed: {result['message']}")
                return False
                
        except Exception as e:
            logger.error(f"💥 TTS error: {e}")
            return False
    
    async def get_status(self) -> dict:
        """Отримання статусу TTS системи"""
        return await self.server.call_tool("tts_status", {})
    
    async def list_voices(self) -> dict:
        """Отримання списку голосів"""
        return await self.server.call_tool("list_voices", {})

# Глобальний екземпляр для Goose
_goose_tts = None

def get_tts_instance():
    """Отримання singleton екземпляру TTS"""
    global _goose_tts
    if _goose_tts is None:
        _goose_tts = GooseUkrainianTTS()
    return _goose_tts

async def goose_speak(text: str, voice: str = "mykyta", lang: str = "uk") -> bool:
    """
    Головна функція для озвучення в Goose
    
    Usage:
        from goose_integration import goose_speak
        await goose_speak("Привіт! Я Goose AI!")
    """
    tts = get_tts_instance()
    return await tts.speak(text, voice, lang)

async def goose_speak_ukrainian(text: str, voice: str = "mykyta") -> bool:
    """Озвучення українською мовою"""
    return await goose_speak(text, voice, "uk")

async def goose_speak_english(text: str) -> bool:
    """Озвучення англійською мовою"""
    return await goose_speak(text, "default", "en")

async def demo():
    """Демонстрація можливостей"""
    print("🎙️ Goose Ukrainian TTS Demo")
    
    # Тестові фрази
    test_phrases = [
        ("Привіт! Я Goose AI, і я можу говорити українською!", "mykyta", "uk"),
        ("Це дуже круто! Тепер я можу озвучувати свої відповіді!", "tetiana", "uk"),
        ("Hello! I can also speak English using Google TTS.", "default", "en"),
    ]
    
    for text, voice, lang in test_phrases:
        print(f"\n🗣️ Speaking: {text}")
        success = await goose_speak(text, voice, lang)
        print(f"   {'✅ Success' if success else '❌ Failed'}")
        await asyncio.sleep(1)
    
    print("\n📊 TTS Status:")
    tts = get_tts_instance()
    status = await tts.get_status()
    if status["status"] == "success":
        engines = status["engines"]
        print(f"   Ukrainian TTS: {'✅' if engines['ukrainian_tts'] else '❌'}")
        print(f"   Google TTS: {'✅' if engines['google_tts'] else '❌'}")
        print(f"   Audio System: {'✅' if engines['pygame_audio'] else '❌'}")
        print(f"   Primary Engine: {status['primary_engine']}")

if __name__ == "__main__":
    asyncio.run(demo())
