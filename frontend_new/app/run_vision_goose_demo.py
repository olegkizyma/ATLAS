#!/usr/bin/env python3
"""
ATLAS Vision + Goose Integration Runner
Запускає інтегровану систему для тестування та демонстрації
"""

import asyncio
import json
import sys
from pathlib import Path

# Add current directory to path
sys.path.insert(0, str(Path(__file__).parent))

# Try to import helpers; fall back to importing the module and extracting attributes defensively
try:
    from goose_vision_client import (
        setup_vision_with_goose,
        goose_vision_client,
        get_vision_tools_status,
        analyze_image_with_goose
    )
    print("✅ Using new unified GooseVisionClient")
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
    except Exception as e2:
        print(f"❌ Failed to import any vision modules: {e2}")
        setup_vision_with_goose = None
        goose_vision_client = None
        get_vision_tools_status = lambda: {}
        analyze_image_with_goose = None


async def interactive_demo():
    """Інтерактивна демонстрація можливостей"""
    print("🚀 ATLAS Vision + Goose Integration Demo")
    print("=" * 50)
    
    # Status check
    print("\n📊 System Status:")
    status = get_vision_tools_status()
    for key, value in status.items():
        icon = "✅" if value else "❌"
        print(f"  {icon} {key}: {value}")
    
    # Setup Goose integration
    print("\n🔧 Setting up Goose integration...")
    try:
        success = await setup_vision_with_goose()
        if success:
            print("✅ Goose integration ready!")
        else:
            print("❌ Goose integration failed. Continue with limited functionality.")
    except Exception as e:
        print(f"❌ Setup error: {e}")
        success = False
    
    while True:
        print("\n" + "=" * 50)
        print("Choose an action:")
        print("1. Take screenshot and analyze")
        print("2. Chat with vision-enabled Goose")
        print("3. Test vision analysis with sample image")
        print("4. Show system status")
        print("5. Exit")
        
        choice = input("\nEnter choice (1-5): ").strip()
        
        if choice == "1":
            await demo_screenshot_analysis()
        elif choice == "2":
            await demo_chat_integration()
        elif choice == "3":
    """Демо аналізу скріншоту"""
    print("\n📸 Screenshot Analysis Demo")
    print("-" * 30)
    
    try:
        result = goose_vision_integration.execute_screenshot_monitor({
            "action": "capture"
        })
        
        if result and len(result) > 0:
            print("✅ Screenshot captured successfully!")
            print(f"Result: {result[0]['text']}")
        else:
            print("❌ Screenshot capture failed")
    except Exception as e:
        print(f"❌ Error: {e}")


async def demo_chat_integration():
    """Демо чат інтеграції"""
    print("\n💬 Chat Integration Demo")
    print("-" * 30)
    print("You can ask questions like:")
    print("- 'Take a screenshot and tell me what you see'")
    print("- 'Analyze the current screen interface'")
    print("- 'What vision tools do you have available?'")
    print()
    
    while True:
        user_input = input("You: ").strip()
        if user_input.lower() in ['exit', 'quit', 'back']:
            break
        
        if not user_input:
            continue
        
        print("🤔 Thinking...")
        try:
            response = await goose_vision_integration.chat_with_vision(user_input)
            print(f"🤖 Goose: {response}")
        except Exception as e:
            print(f"❌ Chat error: {e}")


async def demo_sample_analysis():
    """Демо аналізу зразкового зображення"""
    print("\n🔍 Sample Image Analysis Demo")
    print("-" * 30)
    
    # Create a simple test image (red 2x2 pixels)
    sample_image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8AAAf/PwAABAAMLAQEOAAAAAElFTkSuQmCC"
    
    try:
        result = goose_vision_integration.execute_vision_analysis({
            "image_data": sample_image,
            "analysis_type": "full",
            "enhance_image": True
        })
        
        if result and len(result) > 0:
            print("✅ Analysis completed!")
            print(f"Result: {result[0]['text']}")
        else:
            print("❌ Analysis failed")
    except Exception as e:
        print(f"❌ Error: {e}")


def demo_status():
    """Демо перевірки статусу"""
    print("\n📊 System Status Details")
    print("-" * 30)
    
    status = get_vision_tools_status()
    
    print("Core Components:")
    for key in ['vision_processor', 'grisha_monitor', 'goose_integration']:
        if key in status:
            icon = "✅" if status[key] else "❌"
            print(f"  {icon} {key}")
    
    print("\nDependencies:")
    for key in ['cv2_available', 'mediapipe_available', 'yolo_available', 'pyautogui_available']:
        if key in status:
            icon = "✅" if status[key] else "❌"
            name = key.replace('_available', '').upper()
            print(f"  {icon} {name}")
    
    if 'temp_directory' in status and status['temp_directory']:
        print(f"\nTemp Directory: {status['temp_directory']}")
    
    # Check if Goose is accessible (try ports 3000 and 3001)
    print("\nGoose Connectivity:")
    try:
        import httpx
        for port in (3000, 3001):
            try:
                url = f"http://127.0.0.1:{port}/status"
                with httpx.Client(timeout=2.0) as client:
                    resp = client.get(url)
                    if resp.status_code == 200:
                        print(f"  ✅ Goose server accessible on port {port}")
                    else:
                        print(f"  ⚠️ Goose reachable on port {port} but returned {resp.status_code}")
            except Exception:
                # try root path for web version
                try:
                    url2 = f"http://127.0.0.1:{port}/"
                    with httpx.Client(timeout=2.0) as client:
                        r2 = client.get(url2)
                        if r2.status_code == 200:
                            print(f"  ✅ Goose web accessible on port {port}")
                        else:
                            print(f"  ❌ Goose not responding on port {port}")
                except Exception:
                    print(f"  ❌ Goose not accessible on port {port}")
    except Exception as e:
        print(f"  ❌ Cannot check Goose connectivity (httpx missing?): {e}")


async def main():
    """Головна функція"""
    try:
        await interactive_demo()
    except KeyboardInterrupt:
        print("\n\n👋 Demo interrupted by user. Goodbye!")
    except Exception as e:
        print(f"\n❌ Demo error: {e}")


if __name__ == "__main__":
    asyncio.run(main())
