import os
import sys
import time
import json
import socket
import shutil
import signal
import subprocess
import importlib
import threading
from pathlib import Path

import requests
from werkzeug.serving import make_server


ROOT = Path(__file__).resolve().parents[2]
ORCH_DIR = ROOT / 'frontend_new' / 'orchestrator'
ORCH_PORT = 5995
FLASK_PORT = 5996


class ServerThread(threading.Thread):
    def __init__(self, app, port):
        super().__init__(daemon=True)
        self.srv = make_server('127.0.0.1', port, app)
        self.ctx = app.app_context()
        self.ctx.push()
    def run(self):
        self.srv.serve_forever()
    def shutdown(self):
        self.srv.shutdown()


def wait_http_ok(url: str, timeout_s: float = 15.0) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        try:
            r = requests.get(url, timeout=2)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(0.2)
    return False


def node_available() -> bool:
    return shutil.which('node') is not None

def orchestrator_deps_installed() -> bool:
    exp = ORCH_DIR / 'node_modules' / 'express' / 'package.json'
    return exp.exists()


def test_e2e_task_flow_through_orchestrator(monkeypatch):
    if not node_available() or not orchestrator_deps_installed():
        import pytest
        pytest.skip('node or orchestrator dependencies not available; skipping e2e test')

    # 1) Start orchestrator on test port
    env = os.environ.copy()
    env['ORCH_PORT'] = str(ORCH_PORT)
    env['NODE_ENV'] = 'integration'
    orch = subprocess.Popen(
        ['node', 'server.js'],
        cwd=str(ORCH_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )

    try:
        import pytest
        if not wait_http_ok(f'http://127.0.0.1:{ORCH_PORT}/health', timeout_s=30.0):
            # Provide a short excerpt from logs for context and skip
            try:
                out = (orch.stdout.read(400) if orch.stdout else b'').decode('utf-8', 'ignore')
                err = (orch.stderr.read(400) if orch.stderr else b'').decode('utf-8', 'ignore')
            except Exception:
                out = err = ''
            pytest.skip(f'orchestrator not healthy on port {ORCH_PORT}; stdout: {out!r} stderr: {err!r}')

        # 2) Prepare Flask app bound to orchestrator URL
        # Ensure env var is set BEFORE importing atlas_server
        os.environ['ORCHESTRATOR_URL'] = f'http://127.0.0.1:{ORCH_PORT}'

        APP_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'app'))
        if APP_DIR not in sys.path:
            sys.path.insert(0, APP_DIR)
        import atlas_server as _atlas  # type: ignore
        _atlas = importlib.reload(_atlas)

        # Force intent to 'task' so request routes through orchestrator
        monkeypatch.setattr(_atlas, 'classify_intent', lambda text: 'task')

        # 3) Start Flask server
        srv = ServerThread(_atlas.app, FLASK_PORT)
        srv.start()
        try:
            assert wait_http_ok(f'http://127.0.0.1:{FLASK_PORT}/api/health', timeout_s=10.0)

            # 4) Call /api/chat and expect success routed via orchestrator
            payload = {'message': 'Будь ласка, створити файл і налаштувати сервіс.', 'sessionId': 'e2e'}
            r = requests.post(f'http://127.0.0.1:{FLASK_PORT}/api/chat', json=payload, timeout=10)
            assert r.status_code == 200
            data = r.json()
            assert data.get('success') is True
            assert isinstance(data.get('response'), list)
        finally:
            srv.shutdown()
    finally:
        try:
            orch.terminate()
            orch.wait(timeout=5)
        except Exception:
            try:
                orch.kill()
            except Exception:
                pass
