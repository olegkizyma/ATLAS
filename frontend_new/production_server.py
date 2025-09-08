#!/usr/bin/env python3
"""
Production ATLAS Frontend Server
Uses gunicorn for production deployment instead of Flask development server
"""

import os
import sys
import logging
from pathlib import Path

# Add app directory to path
sys.path.insert(0, str(Path(__file__).parent / 'app'))

def create_app():
    """Create Flask application for gunicorn"""
    from atlas_server import app
    return app

if __name__ == '__main__':
    # For gunicorn usage: gunicorn -w 4 -b 0.0.0.0:5001 production_server:create_app
    print("Use: gunicorn -w 4 -b 0.0.0.0:5001 production_server:create_app")
    print("Or for development: python app/atlas_server.py")
