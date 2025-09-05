import os
import threading
import time
import requests
from werkzeug.serving import make_server

import sys
APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app'))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)
from atlas_server import app  # type: ignore

# Monkeypatch TTS endpoints inside app by overriding helper functions

def test_tts_synthesize_with_mock(monkeypatch):
    # Mock _tts_post to return a fake wav payload
    class Resp:
        status_code = 200
        content = b'RIFF' + b'\x00' * 100  # minimal stub, not a valid wav but enough for route logic
        text = ''

    def fake_post(path, json_payload, timeout):
        return Resp(), 'http://mock-tts'

    # Disable lock contention
    from atlas_server import _tts_post, tts_lock  # type: ignore
    monkeypatch.setattr('atlas_server._tts_post', fake_post)

    # Start server
    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        payload = {
            'text': 'Привіт! Це тест.',
            'agent': 'atlas',
            'voice': 'dmytro',
            'rate': 1.0
        }
        r = requests.post(f'{BASE}/api/voice/synthesize', json=payload, timeout=5)
        assert r.status_code == 200
        # Should be WAV content
        assert r.headers.get('Content-Type','').startswith('audio/wav')
    finally:
        srv.shutdown()


# Helpers
BASE = 'http://127.0.0.1:5998'

class ServerThread(threading.Thread):
    def __init__(self, app, port=5998):
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

def make_test_server(app):
    return ServerThread(app)
