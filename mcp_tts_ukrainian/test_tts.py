#!/usr/bin/env python3
"""
Тест Ukrainian TTS MCP Server
============================

Тестовий скрипт для перевірки функціональності українського TTS сервера
"""

import asyncio
import json
import logging

# Налаштування логування
logging.basicConfig(level=logging.INFO)

from mcp_tts_server import UkrainianTTSEngine

async def test_tts():
    """Тестування TTS движка"""
    print("🧪 Starting Ukrainian TTS Test...")
    
    # Ініціалізація движка
    engine = UkrainianTTSEngine()
    
    # Перевірка статусу
    print("\n📊 Engine Status:")
    print(f"Ukrainian TTS: {'✅' if engine.ukrainian_tts else '❌'}")
    print(f"Pygame Audio: {'✅' if engine.pygame_initialized else '❌'}")
    
    # Тестові фрази
    test_phrases = [
        ("Привіт! Це тест українського TTS.", "mykyta", "uk"),
        ("Слава Україні! Героям слава!", "tetiana", "uk"),
        ("Hello! This is an English test.", None, "en"),
        ("Привет! Это русский тест.", None, "ru"),
    ]
    
    print("\n🎙️ Testing TTS...")
    
    for i, (text, voice, lang) in enumerate(test_phrases, 1):
        print(f"\n{i}. Testing: {text[:30]}...")
        print(f"   Voice: {voice or 'default'}, Lang: {lang}")
        
        try:
            result = await engine.speak(text, voice or "mykyta", lang)
            
            if result["status"] == "success":
                print(f"   ✅ Success: {result['engine']}")
            else:
                print(f"   ❌ Failed: {result['message']}")
                
        except Exception as e:
            print(f"   💥 Error: {e}")
        
        # Пауза між тестами
        await asyncio.sleep(1)
    
    print("\n🏁 Test completed!")

if __name__ == "__main__":
    asyncio.run(test_tts())
