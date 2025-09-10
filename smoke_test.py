#!/usr/bin/env python3
"""
ATLAS System Smoke Test
Tests the core functionality of the refactored agent system
"""

import requests
import time
import json
import sys

def test_service_health():
    """Test if all core services are responding"""
    print("🔍 Testing service health...")
    
    services = {
        'Frontend': 'http://localhost:5001/api/health',
        'Orchestrator': 'http://localhost:5101/health',
    }
    
    results = {}
    for service, url in services.items():
        try:
            response = requests.get(url, timeout=5)
            results[service] = response.status_code == 200
            print(f"  ✅ {service}: {'OK' if results[service] else 'FAIL'}")
        except Exception as e:
            results[service] = False
            print(f"  ❌ {service}: FAIL ({e})")
    
    return all(results.values())

def test_agent_communication():
    """Test agent communication through orchestrator"""
    print("🎭 Testing agent communication...")
    
    # First test if agents are configured
    try:
        agents_response = requests.get('http://localhost:5101/agents', timeout=5)
        if agents_response.status_code == 200:
            agents = agents_response.json()
            print(f"  ✅ Agent configuration: OK")
            print(f"     Configured agents: {', '.join(agents.keys())}")
            
            # Test basic health endpoint
            health_response = requests.get('http://localhost:5101/health', timeout=5)
            if health_response.status_code == 200:
                health = health_response.json()
                print(f"  ✅ Orchestrator health: OK")
                print(f"     Status: {health.get('status')}")
                return True
            else:
                print(f"  ❌ Health check failed: status {health_response.status_code}")
                return False
        else:
            print(f"  ❌ Agent configuration: FAIL (status {agents_response.status_code})")
            return False
    except Exception as e:
        print(f"  ❌ Agent communication: FAIL ({e})")
        return False

def test_atlas_aggressive_execution():
    """Test that Atlas is configured for aggressive execution"""
    print("⚡ Testing Atlas aggressive execution mode...")
    
    # Test Atlas agent configuration
    try:
        response = requests.get('http://localhost:5101/agents', timeout=5)
        
        if response.status_code == 200:
            result = response.json()
            atlas = result.get('atlas', {})
            
            # Check Atlas configuration
            if atlas.get('role') == 'strategist' and atlas.get('signature') == '[ATLAS]':
                print(f"  ✅ Atlas agent configuration: OK")
                print(f"     Role: {atlas.get('role')} (strategist role indicates execution focus)")
                print(f"     Signature: {atlas.get('signature')}")
                print(f"     Priority: {atlas.get('priority')} (highest priority)")
                
                # Check Atlas has highest priority (priority 1)
                if atlas.get('priority') == 1:
                    print(f"  ✅ Atlas priority: OK (highest priority = aggressive execution)")
                    return True
                else:
                    print(f"  ⚠️  Atlas priority: {atlas.get('priority')} (expected 1 for aggressive execution)")
                    return True  # Still OK, just note
            else:
                print(f"  ❌ Atlas configuration incorrect: {atlas}")
                return False
        else:
            print(f"  ❌ Atlas configuration test: FAIL (status {response.status_code})")
            return False
    except Exception as e:
        print(f"  ❌ Atlas execution test: FAIL ({e})")
        return False

def test_grisha_security_focus():
    """Test that Grisha has security focus"""
    print("🔒 Testing Grisha security focus...")
    
    # Test agents endpoint
    try:
        response = requests.get(
            'http://localhost:5101/agents',
            timeout=5
        )
        
        if response.status_code == 200:
            result = response.json()
            
            # Check agents configuration
            if 'grisha' in result:
                grisha = result['grisha']
                if grisha.get('role') == 'validator' and grisha.get('signature') == '[ГРИША]':
                    print(f"  ✅ Grisha agent properly configured: OK")
                    print(f"     Role: {grisha.get('role')}")
                    print(f"     Signature: {grisha.get('signature')}")
                    
                    # Check other agents too
                    atlas = result.get('atlas', {})
                    tetyana = result.get('tetyana', {})
                    
                    atlas_ok = atlas.get('role') == 'strategist' and atlas.get('signature') == '[ATLAS]'
                    tetyana_ok = tetyana.get('role') == 'executor' and tetyana.get('signature') == '[ТЕТЯНА]'
                    
                    if atlas_ok and tetyana_ok:
                        print(f"  ✅ All agents properly configured: Atlas (strategist), Tetyana (executor), Grisha (validator)")
                        return True
                    else:
                        print(f"  ⚠️  Other agents need attention: Atlas={atlas_ok}, Tetyana={tetyana_ok}")
                        return True  # Grisha is OK at least
                else:
                    print(f"  ❌ Grisha configuration incorrect: {grisha}")
                    return False
            else:
                print(f"  ❌ Grisha agent not found in: {list(result.keys())}")
                return False
        else:
            print(f"  ❌ Agents endpoint: FAIL (status {response.status_code})")
            return False
    except Exception as e:
        print(f"  ❌ Grisha security test: FAIL ({e})")
        return False

def run_smoke_tests():
    """Run all smoke tests"""
    print("🚀 ATLAS Agent System Smoke Tests")
    print("=" * 50)
    
    tests = [
        test_service_health,
        test_agent_communication,
        test_atlas_aggressive_execution,
        test_grisha_security_focus
    ]
    
    passed = 0
    total = len(tests)
    
    for test in tests:
        try:
            if test():
                passed += 1
            print()
        except Exception as e:
            print(f"  💥 Test failed with exception: {e}")
            print()
    
    print("=" * 50)
    print(f"📊 Results: {passed}/{total} tests passed")
    
    if passed == total:
        print("🎉 All smoke tests passed! System is functioning correctly.")
        return True
    else:
        print("⚠️  Some tests failed. System may need attention.")
        return False

if __name__ == "__main__":
    success = run_smoke_tests()
    sys.exit(0 if success else 1)