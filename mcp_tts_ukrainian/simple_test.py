#!/usr/bin/env python3
"""
Простий тест Ukrainian TTS через MCP
"""

import json
import asyncio
from mcp_tts_server import MCPTTSServer

async def simple_test():
    """Простий тест MCP сервера"""
    print("🧪 Simple MCP Server Test...")
    
    # Створення сервера
    server = MCPTTSServer()
    
    # Тест 1: Список інструментів
    print("\n1️⃣ Available tools:")
    tools = server.get_available_tools()
    for tool_name, tool_info in tools["tools"].items():
        print(f"   🔧 {tool_name}: {tool_info['description']}")
    
    # Тест 2: Статус TTS
    print("\n2️⃣ TTS Status:")
    result = await server.call_tool("tts_status", {})
    print(f"   Status: {result['status']}")
    if result['status'] == 'success':
        engines = result['engines']
        print(f"   Ukrainian TTS: {'✅' if engines['ukrainian_tts'] else '❌'}")
        print(f"   Google TTS: {'✅' if engines['google_tts'] else '❌'}")
        print(f"   Pygame Audio: {'✅' if engines['pygame_audio'] else '❌'}")
        print(f"   Primary Engine: {result['primary_engine']}")
    
    # Тест 3: Список голосів
    print("\n3️⃣ Available voices:")
    result = await server.call_tool("list_voices", {})
    if result['status'] == 'success':
        for lang, voices in result['voices'].items():
            print(f"   🎵 {lang}: {', '.join(voices)}")
        print(f"   🌐 Languages: {', '.join(result['languages'])}")
    
    # Тест 4: Українське озвучення
    print("\n4️⃣ Testing Ukrainian TTS:")
    result = await server.call_tool("say_tts", {
        "text": "Привіт! Це тест українського озвучення!",
        "voice": "mykyta",
        "lang": "uk"
    })
    print(f"   Result: {result['status']}")
    if result['status'] == 'success':
        print(f"   Engine: {result['engine']}")
        print(f"   Voice: {result['voice']}")
        print(f"   Message: {result['message']}")
    else:
        print(f"   Error: {result['message']}")
    
    # Тест 5: Англійське озвучення
    print("\n5️⃣ Testing English TTS:")
    result = await server.call_tool("say_tts", {
        "text": "Hello! This is an English test!",
        "lang": "en"
    })
    print(f"   Result: {result['status']}")
    if result['status'] == 'success':
        print(f"   Engine: {result['engine']}")
        print(f"   Message: {result['message']}")
    else:
        print(f"   Error: {result['message']}")
    
    print("\n✅ Simple test completed!")

if __name__ == "__main__":
    asyncio.run(simple_test())
