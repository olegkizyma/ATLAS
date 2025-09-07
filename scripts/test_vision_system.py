#!/usr/bin/env python3
"""
Test script for ATLAS Vision System
Тестовий скрипт для перевірки функціональності комп'ютерного зору
"""

import sys
import os
import requests
import base64
import json
from pathlib import Path

# Додаємо шлях до додатку
sys.path.append(str(Path(__file__).parent.parent / 'frontend_new' / 'app'))

def test_vision_status():
    """Тестує статус vision системи"""
    print("🔍 Testing vision status...")
    
    try:
        response = requests.get('http://localhost:5001/api/vision/status')
        data = response.json()
        
        print(f"Vision available: {data.get('vision_available')}")
        print(f"Modules: {data.get('modules')}")
        
        return data.get('vision_available', False)
    except Exception as e:
        print(f"❌ Status test failed: {e}")
        return False

def create_test_image():
    """Створює тестове зображення"""
    try:
        from PIL import Image, ImageDraw
        import io
        
        # Створюємо просте тестове зображення
        img = Image.new('RGB', (400, 300), color='lightblue')
        draw = ImageDraw.Draw(img)
        
        # Малюємо простий смайлик
        # Обличчя
        draw.ellipse([100, 50, 300, 250], outline='black', width=3)
        
        # Очі
        draw.ellipse([140, 100, 160, 120], fill='black')
        draw.ellipse([240, 100, 260, 120], fill='black')
        
        # Усмішка
        draw.arc([150, 150, 250, 200], start=0, end=180, fill='black', width=3)
        
        # Конвертуємо в base64
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG')
        buffer.seek(0)
        
        image_base64 = base64.b64encode(buffer.getvalue()).decode('utf-8')
        return f"data:image/jpeg;base64,{image_base64}"
        
    except ImportError:
        print("⚠️ PIL not available, using placeholder")
        # Повертаємо мінімальний base64 зображення (1x1 pixel)
        return "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="

def test_vision_upload():
    """Тестує завантаження та базовий аналіз"""
    print("\n📤 Testing vision upload...")
    
    image_data = create_test_image()
    
    try:
        response = requests.post('http://localhost:5001/api/vision/upload', 
                               json={'image': image_data})
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Upload successful!")
            print(f"Analysis: {data.get('analysis', {}).get('scene_description', 'No description')}")
            print(f"Sequence steps: {len(data.get('sequence', []))}")
            return data
        else:
            print(f"❌ Upload failed: {response.status_code}")
            print(f"Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Upload test failed: {e}")
        return None

def test_vision_enhance():
    """Тестує покращення зображення"""
    print("\n🎨 Testing image enhancement...")
    
    image_data = create_test_image()
    
    try:
        response = requests.post('http://localhost:5001/api/vision/enhance',
                               json={'image': image_data})
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Enhancement successful!")
            print(f"Enhanced image size: {len(data.get('enhanced_image', ''))} chars")
            return data
        else:
            print(f"❌ Enhancement failed: {response.status_code}")
            print(f"Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Enhancement test failed: {e}")
        return None

def test_vision_analyze():
    """Тестує детальний аналіз з відео"""
    print("\n🎬 Testing detailed analysis with video...")
    
    image_data = create_test_image()
    
    try:
        response = requests.post('http://localhost:5001/api/vision/analyze',
                               json={
                                   'image': image_data,
                                   'generate_video': True
                               })
        
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Analysis successful!")
            print(f"Scene: {data.get('scene_description', 'No description')}")
            print(f"Video available: {data.get('video_available', False)}")
            
            if data.get('video_available'):
                print(f"Video path: {data.get('video_path', 'No path')}")
            
            # Показуємо послідовність дій
            sequence = data.get('sequence', [])
            print(f"\nAction sequence ({len(sequence)} steps):")
            for i, step in enumerate(sequence, 1):
                print(f"  {i}. {step.get('description')} ({step.get('duration')}s)")
            
            return data
        else:
            print(f"❌ Analysis failed: {response.status_code}")
            print(f"Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Analysis test failed: {e}")
        return None

def test_vision_processor_direct():
    """Тестує vision processor напряму"""
    print("\n🔧 Testing vision processor directly...")
    
    try:
        from vision_processor import vision_processor
        
        # Створюємо тестове зображення
        image_data = create_test_image()
        
        # Обробляємо зображення
        result = vision_processor.process_image_upload(image_data)
        
        if result['success']:
            print(f"✅ Direct processing successful!")
            print(f"Analysis: {result['analysis']['scene_description']}")
            print(f"Sequence: {len(result['sequence'])} steps")
            
            # Тестуємо генерацію відео
            video_path = vision_processor.generate_video_sequence(
                result['enhanced_path'], 
                result['sequence']
            )
            
            if video_path:
                print(f"✅ Video generated: {video_path}")
            else:
                print("⚠️ Video generation failed")
                
            return result
        else:
            print(f"❌ Direct processing failed: {result['error']}")
            return None
            
    except ImportError as e:
        print(f"⚠️ Vision processor not available: {e}")
        return None
    except Exception as e:
        print(f"❌ Direct test failed: {e}")
        return None

def test_frontend_integration():
    """Тестує інтеграцію з frontend"""
    print("\n🌐 Testing frontend integration...")
    
    try:
        # Перевіряємо чи frontend запущений
        response = requests.get('http://localhost:5001/')
        
        if response.status_code == 200:
            print("✅ Frontend is running")
            
            # Перевіряємо наявність vision.js
            js_response = requests.get('http://localhost:5001/static/js/vision.js')
            if js_response.status_code == 200:
                print("✅ Vision.js is available")
                print(f"Script size: {len(js_response.text)} chars")
            else:
                print("❌ Vision.js not found")
            
            return True
        else:
            print(f"❌ Frontend not running: {response.status_code}")
            return False
            
    except Exception as e:
        print(f"❌ Frontend test failed: {e}")
        return False

def main():
    """Головна функція тестування"""
    print("🚀 ATLAS Vision System Test Suite")
    print("=" * 50)
    
    # Тестуємо frontend
    frontend_ok = test_frontend_integration()
    
    if not frontend_ok:
        print("\n⚠️ Frontend not available, testing only direct processor...")
        test_vision_processor_direct()
        return
    
    # Тестуємо API
    vision_available = test_vision_status()
    
    if not vision_available:
        print("\n⚠️ Vision system not available, check dependencies")
        return
    
    # Виконуємо всі тести
    upload_result = test_vision_upload()
    enhance_result = test_vision_enhance()
    analyze_result = test_vision_analyze()
    
    # Підсумок
    print("\n" + "=" * 50)
    print("📊 Test Results Summary:")
    print(f"Frontend: {'✅' if frontend_ok else '❌'}")
    print(f"Vision Status: {'✅' if vision_available else '❌'}")
    print(f"Upload: {'✅' if upload_result else '❌'}")
    print(f"Enhancement: {'✅' if enhance_result else '❌'}")
    print(f"Analysis: {'✅' if analyze_result else '❌'}")
    
    if all([frontend_ok, vision_available, upload_result, enhance_result, analyze_result]):
        print("\n🎉 All tests passed! ATLAS Vision System is working correctly.")
    else:
        print("\n⚠️ Some tests failed. Check the output above for details.")

if __name__ == '__main__':
    main()
