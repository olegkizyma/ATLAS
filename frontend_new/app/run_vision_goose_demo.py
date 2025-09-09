#!/usr/bin/env python3
"""
ATLAS Vision + Goose Integration Demo
Використовує новий об'єднаний GooseVisionClient для демонстрації функціональності
"""

import os
import sys
import asyncio
import pyautogui
from pathlib import Path

# Add app directory to path
app_dir = Path(__file__).parent
sys.path.insert(0, str(app_dir))

# Defensive import
try:
    import time
except ImportError:
    print("⚠️  time module not available, using fallback")
    class time:
        @staticmethod
        def sleep(seconds):
            import asyncio
            asyncio.sleep(seconds)

# Try to import helpers; fall back to importing the module and extracting attributes defensively
try:
    from goose_vision_client import (
        GooseVisionClient,
        get_vision_tools_status,
        analyze_image_with_goose
    )
    print("✅ Using new unified GooseVisionClient")
    goose_vision_client = None  # Will be initialized in main
except Exception as e:
    print(f"⚠️  Fallback to vision_processor: {e}")
    try:
        from vision_processor import (
            setup_vision_with_goose,
            goose_vision_integration as goose_vision_client,
            get_vision_tools_status,
            vision_processor
        )
        analyze_image_with_goose = getattr(vision_processor, 'analyze_image_with_goose', None)
        GooseVisionClient = None
    except Exception as e2:
        print(f"❌ Failed to import any vision modules: {e2}")
        setup_vision_with_goose = None
        goose_vision_client = None
        get_vision_tools_status = lambda: {}
        analyze_image_with_goose = None
        GooseVisionClient = None

def print_status():
    """Показати статус компонентів системи"""
    print("\n🔍 ATLAS Vision + Goose Integration Demo")
    print("=" * 50)
    
    if GooseVisionClient:
        print("✅ GooseVisionClient: Available")
    else:
        print("❌ GooseVisionClient: Not available")
    
    if goose_vision_client:
        print("✅ Legacy goose_vision_integration: Available")
    else:
        print("❌ Legacy goose_vision_integration: Not available")
        
    # Показати статус інструментів vision
    try:
        tools_status = get_vision_tools_status()
        print(f"\n📊 Vision Tools Status: {tools_status}")
    except Exception as e:
        print(f"⚠️  Cannot get vision tools status: {e}")

async def demo_screenshot_analysis():
    """Демо аналізу скріншоту"""
    print("\n📸 Screenshot Analysis Demo")
    print("-" * 30)
    
    try:
        # Take screenshot
        screenshot = pyautogui.screenshot()
        screenshot_path = "/tmp/demo_screenshot.png"
        screenshot.save(screenshot_path)
        print(f"✅ Screenshot saved: {screenshot_path}")
        
        if goose_vision_client and hasattr(goose_vision_client, 'execute_vision_analysis'):
            # Use unified client
            result = await goose_vision_client.execute_vision_analysis({
                'task': 'screenshot_analysis',
                'image_path': screenshot_path,
                'prompt': 'Опиши що ти бачиш на цьому скріншоті'
            })
            print(f"🤖 Goose Analysis: {result}")
        else:
            print("⚠️  No vision analysis client available")
            
    except Exception as e:
        print(f"❌ Screenshot demo failed: {e}")

async def demo_interactive_chat():
    """Демо інтерактивного чату з vision можливостями"""
    print("\n💬 Interactive Vision Chat Demo")
    print("-" * 35)
    print("Введіть 'exit' для виходу, 'screenshot' для аналізу скріншоту")
    
    while True:
        try:
            user_input = input("\n👤 You: ").strip()
            
            if user_input.lower() in ['exit', 'quit', 'вихід']:
                print("👋 До побачення!")
                break
                
            elif user_input.lower() == 'screenshot':
                await demo_screenshot_analysis()
                continue
                
            if goose_vision_client and hasattr(goose_vision_client, 'chat_with_vision'):
                # Use unified client
                response = await goose_vision_client.chat_with_vision(user_input)
                print(f"🤖 Goose: {response}")
            else:
                print("⚠️  Chat client not available")
                
        except KeyboardInterrupt:
            print("\n👋 Interrupted by user")
            break
        except Exception as e:
            print(f"❌ Chat error: {e}")

async def demo_vision_analysis():
    """Демо аналізу зображення"""
    print("\n🖼️  Vision Analysis Demo")
    print("-" * 25)
    
    if not (goose_vision_client or analyze_image_with_goose):
        print("❌ No vision analysis available")
        return
        
    # Try to find a test image or create one
    try:
        if goose_vision_client and hasattr(goose_vision_client, 'execute_vision_analysis'):
            result = await goose_vision_client.execute_vision_analysis({
                'task': 'test_vision',
                'prompt': 'Тест системи комп\'ютерного зору'
            })
            print(f"🔍 Vision Test Result: {result}")
        else:
            print("⚠️  Vision analysis method not available")
            
    except Exception as e:
        print(f"❌ Vision analysis failed: {e}")

async def main():
    """Головна функція демо"""
    global goose_vision_client
    
    print_status()
    
    # Initialize unified client if available
    if GooseVisionClient and not goose_vision_client:
        try:
            goose_vision_client = GooseVisionClient()
            await goose_vision_client.setup_agent()
            print("✅ GooseVisionClient initialized successfully")
        except Exception as e:
            print(f"⚠️  Failed to initialize GooseVisionClient: {e}")
    
    print("\n🚀 Starting Demo Scenarios...")
    
    # Run demo scenarios
    try:
        await demo_vision_analysis()
        await demo_screenshot_analysis()
        await demo_interactive_chat()
    except Exception as e:
        print(f"❌ Demo failed: {e}")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Demo interrupted by user")
    except Exception as e:
        print(f"❌ Demo startup failed: {e}")
