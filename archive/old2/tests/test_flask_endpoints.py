import os
import json
import threading
import time
import requests
from werkzeug.serving import make_server

# Import Flask app
import sys
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app'))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
from atlas_server import app  # type: ignore

class ServerThread(threading.Thread):
    def __init__(self, app, port=5999):
        threading.Thread.__init__(self)
        self.srv = make_server('127.0.0.1', port, app)
        self.port = port
        self.ctx = app.app_context()
        self.ctx.push()
        self.daemon = True
    def run(self):
        self.srv.serve_forever()
    def shutdown(self):
        self.srv.shutdown()

BASE = 'http://127.0.0.1:5999'


def test_health_and_status_endpoints():
    srv = ServerThread(app)
    srv.start()
    try:
        # Give server a moment
        time.sleep(0.2)
        r = requests.get(f'{BASE}/api/health', timeout=3)
        assert r.status_code == 200
        data = r.json()
        assert data.get('status') == 'ok'
        r2 = requests.get(f'{BASE}/api/status', timeout=3)
        assert r2.status_code == 200
        js = r2.json()
        assert 'processes' in js and 'frontend' in js['processes']
    finally:
        srv.shutdown()


def test_prepare_response_endpoint():
    srv = ServerThread(app)
    srv.start()
    try:
        time.sleep(0.2)
        payload = {"text": "[ТЕТЯНА] [VOICE] Привіт! Тестуємо."}
        r = requests.post(f'{BASE}/api/voice/prepare_response', json=payload, timeout=3)
        assert r.status_code == 200
        js = r.json()
        assert js.get('success') is True
        assert js.get('agent') == 'tetyana'
        assert 'Привіт' in js.get('text', '')
    finally:
        srv.shutdown()
