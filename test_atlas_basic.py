#!/usr/bin/env python3
"""
Basic ATLAS tests that should always pass
"""
import os
import sys

def test_repository_structure():
    """Test that basic repository structure exists"""
    required_dirs = ['frontend_new', 'scripts', '.github']
    for dir_name in required_dirs:
        assert os.path.exists(dir_name), f"Directory {dir_name} should exist"

def test_basic_files():
    """Test that basic files exist"""
    required_files = [
        'frontend_new/requirements.txt',
        'frontend_new/orchestrator/package.json',
        'README.md'
    ]
    for file_name in required_files:
        assert os.path.exists(file_name), f"File {file_name} should exist"

def test_python_version():
    """Test Python version compatibility"""
    assert sys.version_info >= (3, 8), "Python 3.8+ required"

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])
