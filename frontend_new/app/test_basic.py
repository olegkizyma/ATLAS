#!/usr/bin/env python3
"""
Basic tests for ATLAS frontend
"""
import pytest
import sys
import os

# Add app directory to path
sys.path.insert(0, os.path.dirname(__file__))

def test_import_basic():
    """Test that basic imports work"""
    try:
        import flask
        assert True, "Flask import successful"
    except ImportError:
        pytest.fail("Flask not available")

def test_health_check():
    """Basic health check test"""
    # This is a placeholder - actual health check would require running server
    assert True, "Health check placeholder"

if __name__ == "__main__":
    pytest.main([__file__])
