#!/usr/bin/env python3
"""
Тест інтеграції ATLAS Vision з Goose
"""

import asyncio
import sys
import os
from pathlib import Path

# Add the current directory to Python path
sys.path.insert(0, str(Path(__file__).parent))

from vision_processor import (
    setup_vision_with_goose,
    analyze_image_with_goose,
    get_vision_tools_status,
    goose_vision_integration,
    vision_processor
)


async def test_basic_integration():
    """Тестує базову інтеграцію з Goose"""
    print("🔧 Testing basic Goose integration...")
    
    try:
        success = await setup_vision_with_goose()
        if success:
            print("✅ Goose integration setup successful")
        else:
            print("❌ Goose integration setup failed")
        return success
    except Exception as e:
        print(f"❌ Integration test failed: {e}")
        return False


async def test_vision_analysis_tool():
    """Тестує vision analysis tool через Goose"""
    print("\n🔍 Testing vision analysis tool...")
    
    try:
        # Simple test image (1x1 pixel red)
        test_image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mP8z8AAAQAEVAAAAABAgQJ/AAAAAElFTkSuQmCC"
        
        # Test direct tool execution
        result = goose_vision_integration.execute_vision_analysis({
            "image_data": test_image,
            "analysis_type": "full",
            "enhance_image": True
        })
        
        if result and len(result) > 0:
            print("✅ Vision analysis tool works")
            print(f"   Result: {result[0]['text'][:100]}...")
        else:
            print("❌ Vision analysis tool failed")
        
        return True
    except Exception as e:
        print(f"❌ Vision analysis test failed: {e}")
        return False


async def test_screenshot_tool():
    """Тестує screenshot tool через Goose"""
    print("\n📸 Testing screenshot tool...")
    
    try:
        # Test screenshot capture
        result = goose_vision_integration.execute_screenshot_monitor({
            "action": "capture"
        })
        
        if result and len(result) > 0:
            print("✅ Screenshot tool works")
            print(f"   Result: {result[0]['text']}")
        else:
            print("❌ Screenshot tool failed")
        
        return True
    except Exception as e:
        print(f"❌ Screenshot test failed: {e}")
        return False


async def test_chat_integration():
    """Тестує chat інтеграцію з vision tools"""
    print("\n💬 Testing chat integration...")
    
    try:
        response = await goose_vision_integration.chat_with_vision(
            "Привіт! Які vision tools у тебе доступні?"
        )
        
        if response:
            print("✅ Chat integration works")
            print(f"   Response: {response[:200]}...")
        else:
            print("❌ Chat integration failed")
        
        return True
    except Exception as e:
        print(f"❌ Chat integration test failed: {e}")
        return False


def test_status():
    """Тестує статус системи"""
    print("\n📊 Testing system status...")
    
    try:
        status = get_vision_tools_status()
        print("✅ Status check successful:")
        for key, value in status.items():
            status_icon = "✅" if value else "❌"
            print(f"   {status_icon} {key}: {value}")
        
        return True
    except Exception as e:
        print(f"❌ Status test failed: {e}")
        return False


async def main():
    """Головна функція тестування"""
    print("🚀 Starting ATLAS Vision + Goose integration tests...\n")
    
    # Test status first
    test_status()
    
    # Test basic integration
    integration_success = await test_basic_integration()
    
    if integration_success:
        # Test individual tools
        await test_vision_analysis_tool()
        await test_screenshot_tool()
        
        # Test chat integration
        await test_chat_integration()
    else:
        print("\n⚠️  Skipping tool tests due to integration failure")
        print("   Make sure Goose server is running on port 3001")
    
    print("\n🏁 Tests completed!")


if __name__ == "__main__":
    asyncio.run(main())
