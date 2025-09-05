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


BASE = 'http://127.0.0.1:5997'

class ServerThread(threading.Thread):
    def __init__(self, app, port=5997):
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


def test_chat_routes_to_atlas_when_llm_unavailable(monkeypatch):
    # Force classify_intent to return 'chat'
    monkeypatch.setattr('intent_router.classify_intent', lambda text: 'chat')
    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        r = requests.post(f'{BASE}/api/chat', json={
            'message': 'Привіт! Як справи?'
        }, timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data.get('success') is True
        assert isinstance(data.get('response'), list)
        assert data['response'][0]['agent'] == 'atlas'
        assert data['response'][0]['content'].startswith('[ATLAS] ')
    finally:
        srv.shutdown()


def test_chat_routes_to_orchestrator_for_task(monkeypatch):
    # classify_intent → 'task', and mock requests.post to orchestrator
    monkeypatch.setattr('intent_router.classify_intent', lambda text: 'task')

    class Resp:
        status_code = 200
        def json(self):
            return {'success': True, 'response': [{'role': 'assistant', 'agent': 'atlas', 'content': '[ATLAS] ok'}]}

    # Delegate to the real requests.post unless it's orchestrator endpoint
    import requests as _rq
    _orig_post = _rq.post

    def fake_post(url, *args, **kwargs):
        if str(url).endswith('/chat/stream'):
            return Resp()
        return _orig_post(url, *args, **kwargs)

    monkeypatch.setattr('requests.post', fake_post)

    srv = make_test_server(app)
    srv.start()
    try:
        time.sleep(0.1)
        r = requests.post(f'{BASE}/api/chat', json={
            'message': 'Створи файл і налаштуй сервіс'  # це повинно йти в систему задач
        }, timeout=5)
        assert r.status_code == 200
        data = r.json()
        assert data.get('success') is True
        assert isinstance(data.get('response'), list)
    finally:
        srv.shutdown()
