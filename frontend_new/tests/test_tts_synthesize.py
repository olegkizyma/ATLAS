import os
import io
import wave
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

def _make_valid_wav_bytes(ms: int = 100) -> bytes:
    sr = 22050
    frames = int(sr * ms / 1000)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(b"\x00\x00" * frames)
    return buf.getvalue()


def test_tts_synthesize_valid_wav(monkeypatch):
    class Resp:
        status_code = 200
        content = _make_valid_wav_bytes(120)
        text = ''

    def fake_post(path, json_payload, timeout):
        return Resp(), 'http://mock-tts'

    monkeypatch.setattr('atlas_server._tts_post', fake_post)

    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        payload = {'text': 'Привіт! Це тест.', 'agent': 'atlas', 'voice': 'dmytro', 'rate': 1.0}
        r = requests.post(f'{BASE}/api/voice/synthesize', json=payload, timeout=5)
        assert r.status_code == 200
        assert r.headers.get('Content-Type', '').startswith('audio/wav')
        assert r.headers.get('X-TTS-Fallback') is None
    finally:
        srv.shutdown()


def test_tts_synthesize_empty_text_400():
    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        payload = {'text': '   ', 'agent': 'atlas'}
        r = requests.post(f'{BASE}/api/voice/synthesize', json=payload, timeout=5)
        assert r.status_code == 400
        assert 'error' in r.json()
    finally:
        srv.shutdown()


def test_tts_synthesize_unknown_agent_400():
    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        payload = {'text': 'ok', 'agent': 'unknown'}
        r = requests.post(f'{BASE}/api/voice/synthesize', json=payload, timeout=5)
        assert r.status_code == 400
        assert 'error' in r.json()
    finally:
        srv.shutdown()


def test_tts_synthesize_tts_500_fallback_silent(monkeypatch):
    class Resp:
        status_code = 500
        content = b''
        text = 'error'

    def fake_post(path, json_payload, timeout):
        return Resp(), 'http://mock-tts'

    monkeypatch.setattr('atlas_server._tts_post', fake_post)

    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        payload = {'text': 'test', 'agent': 'atlas'}
        r = requests.post(f'{BASE}/api/voice/synthesize', json=payload, timeout=5)
        assert r.status_code == 200
        assert r.headers.get('Content-Type', '').startswith('audio/wav')
        assert r.headers.get('X-TTS-Fallback') == 'silent'
    finally:
        srv.shutdown()


def test_tts_synthesize_tts_200_empty_content_fallback_silent(monkeypatch):
    class Resp:
        status_code = 200
        content = b''
        text = ''

    def fake_post(path, json_payload, timeout):
        return Resp(), 'http://mock-tts'

    monkeypatch.setattr('atlas_server._tts_post', fake_post)

    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        payload = {'text': 'test', 'agent': 'atlas'}
        r = requests.post(f'{BASE}/api/voice/synthesize', json=payload, timeout=5)
        assert r.status_code == 200
        assert r.headers.get('Content-Type', '').startswith('audio/wav')
        assert r.headers.get('X-TTS-Fallback') == 'silent'
    finally:
        srv.shutdown()


def test_tts_synthesize_lock_busy_fallback_busy_silence(monkeypatch):
    class FakeLock:
        def acquire(self, timeout=None):
            return False
        def release(self):
            pass

    monkeypatch.setattr('atlas_server.tts_lock', FakeLock())

    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        payload = {'text': 'test', 'agent': 'atlas'}
        r = requests.post(f'{BASE}/api/voice/synthesize', json=payload, timeout=5)
        assert r.status_code == 200
        assert r.headers.get('Content-Type', '').startswith('audio/wav')
        assert r.headers.get('X-TTS-Fallback') == 'busy-silence'
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
