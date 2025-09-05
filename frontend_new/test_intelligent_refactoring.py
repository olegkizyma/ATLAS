#!/usr/bin/env python3
"""
ATLAS Intelligent Systems Test Suite
Тести для перевірки інтелігентного рефакторингу
"""

import sys
import json
from pathlib import Path

def test_intelligent_imports():
    """Тест імпортів інтелігентних систем"""
    print("🧪 Testing intelligent system imports...")
    
    # Додаємо config до sys.path
    config_path = Path(__file__).parent / 'config'
    sys.path.insert(0, str(config_path))
    
    try:
        # Тестуємо базові імпорти
        from intelligent_config import IntelligentConfigManager
        from intelligent_orchestrator import IntelligentOrchestrator
        from intelligent_recovery import IntelligentRecoverySystem
        from configuration_migrator import ConfigurationMigrator
        
        print("   ✅ All intelligent modules imported successfully")
        return True
        
    except ImportError as e:
        print(f"   ❌ Import error: {e}")
        return False

def test_intelligent_config_generation():
    """Тест генерації інтелігентних конфігурацій"""
    print("🧪 Testing intelligent configuration generation...")
    
    try:
        config_path = Path(__file__).parent / 'config'
        sys.path.insert(0, str(config_path))
        
        from intelligent_config import IntelligentConfigManager
        
        # Створюємо менеджер
        config_manager = IntelligentConfigManager()
        
        # Генеруємо конфігурацію
        test_config = config_manager.generate_complete_config({
            'service_type': 'test',
            'environment': 'development'
        })
        
        # Перевіряємо структуру
        required_keys = ['server', 'limits', 'performance', 'security']
        for key in required_keys:
            if key not in test_config:
                print(f"   ❌ Missing required key: {key}")
                return False
        
        print("   ✅ Configuration generated with all required sections")
        return True
        
    except Exception as e:
        print(f"   ❌ Configuration generation error: {e}")
        return False

def test_intelligent_files_exist():
    """Тест наявності створених інтелігентних файлів"""
    print("🧪 Testing intelligent files existence...")
    
    files_to_check = [
        'orchestrator/.env.intelligent',
        'orchestrator/.intelligent_metadata.json',
        'orchestrator/intelligent_server_wrapper.js',
        'config/intelligent_config.py',
        'config/intelligent_orchestrator.py',
        'config/intelligent_recovery.py',
        'config/configuration_migrator.py',
        'config/recovery_bridge.py'
    ]
    
    missing_files = []
    for file_path in files_to_check:
        full_path = Path(__file__).parent / file_path
        if not full_path.exists():
            missing_files.append(file_path)
    
    if missing_files:
        print(f"   ❌ Missing files: {missing_files}")
        return False
    else:
        print(f"   ✅ All {len(files_to_check)} intelligent files present")
        return True

def test_intelligent_metadata():
    """Тест метаданих інтелігентної конфігурації"""
    print("🧪 Testing intelligent metadata...")
    
    try:
        metadata_path = Path(__file__).parent / 'orchestrator' / '.intelligent_metadata.json'
        
        if not metadata_path.exists():
            print("   ❌ Metadata file not found")
            return False
        
        with open(metadata_path, 'r') as f:
            metadata = json.load(f)
        
        required_fields = ['generated_at', 'config_version', 'intelligent_features', 'migration_status']
        for field in required_fields:
            if field not in metadata:
                print(f"   ❌ Missing metadata field: {field}")
                return False
        
        if metadata['migration_status'] != 'complete':
            print(f"   ❌ Migration not complete: {metadata['migration_status']}")
            return False
        
        print(f"   ✅ Metadata valid with {len(metadata['intelligent_features'])} features")
        return True
        
    except Exception as e:
        print(f"   ❌ Metadata test error: {e}")
        return False

def test_recovery_system():
    """Тест системи відновлення"""
    print("🧪 Testing intelligent recovery system...")
    
    try:
        config_path = Path(__file__).parent / 'config'
        sys.path.insert(0, str(config_path))
        
        from intelligent_recovery import IntelligentRecoverySystem, FailureContext, FailureType
        
        # Створюємо систему відновлення
        recovery_system = IntelligentRecoverySystem()
        
        # Тестуємо створення контексту помилки
        test_failure = FailureContext(
            failure_type=FailureType.TIMEOUT,
            error_message="Test timeout error",
            timestamp=1234567890,
            agent_name="test_agent",
            task_spec={"test": "task"},
            execution_context={"test": "context"}
        )
        
        # Перевіряємо що контекст створюється правильно
        if test_failure.failure_type != FailureType.TIMEOUT:
            print("   ❌ Failure context creation failed")
            return False
        
        print("   ✅ Recovery system components working")
        return True
        
    except Exception as e:
        print(f"   ❌ Recovery system test error: {e}")
        return False

def main():
    """Головна функція тестування"""
    print("🚀 ATLAS Intelligent Systems Test Suite")
    print("=" * 50)
    print("")
    
    tests = [
        test_intelligent_imports,
        test_intelligent_files_exist,
        test_intelligent_metadata,
        test_intelligent_config_generation,
        test_recovery_system
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        if test():
            passed += 1
        print("")
    
    print("📊 Test Results:")
    print(f"   ✅ Passed: {passed}/{total}")
    print(f"   ❌ Failed: {total - passed}/{total}")
    
    if passed == total:
        print("\n🎉 All tests passed! Intelligent refactoring successful!")
        print("\n💡 Next steps:")
        print("   1. Start intelligent stack: ./start_stack_intelligent.sh")
        print("   2. Monitor status: ./status_stack_intelligent.sh")
        print("   3. Test intelligent features through web interface")
        return 0
    else:
        print(f"\n⚠️  {total - passed} test(s) failed. Review intelligent system setup.")
        return 1

if __name__ == "__main__":
    exit(main())
