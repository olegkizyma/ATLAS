#!/usr/bin/env python3
"""
ATLAS Frontend Server with TTS Integration
Flask server that serves the web interface and provides TTS API
"""

import os
import sys
import logging
import json
import hashlib
from datetime import datetime
from flask import Flask, render_template, jsonify, request, send_file, make_response
try:
    from flask_cors import CORS
except ImportError:
    CORS = None
try:
    import requests
except ImportError:
    requests = None
import tempfile
import subprocess
from pathlib import Path
from goose_vision_client import GooseVisionClient
# intent classification is handled in orchestrator now
from stt_manager import stt_manager
from typing import Optional
import io
import wave
from threading import Lock
from time import monotonic
import re
import time
import math
import uuid
import base64
from logging.handlers import RotatingFileHandler

# Computer Vision imports (optional)
try:
    from vision_processor import vision_processor, grisha_monitor
    VISION_AVAILABLE = True
except ImportError as e:
    print(f"Vision processor not available: {e}")
    vision_processor = None
    grisha_monitor = None
    VISION_AVAILABLE = False

try:
    # Optional: robust retry adapter if available
    from requests.adapters import HTTPAdapter  # type: ignore
    from urllib3.util.retry import Retry  # type: ignore
except Exception:
    HTTPAdapter = None
    Retry = None

# Setup logging with unified timezone format
def setup_unified_logging():
    class UTCOffsetFormatter(logging.Formatter):
        def formatTime(self, record, datefmt=None):
            from datetime import datetime, timezone
            import time
            dt = datetime.fromtimestamp(record.created, tz=timezone.utc)
            local_offset = time.timezone if time.daylight == 0 else time.altzone
            offset_hours = -local_offset // 3600
            offset_minutes = (-local_offset % 3600) // 60
            offset_sign = '+' if offset_hours >= 0 else '-'
            offset_str = f"{offset_sign}{abs(offset_hours):02d}:{abs(offset_minutes):02d}"
            return f"{dt.strftime('%Y-%m-%d %H:%M:%S,%f')[:-3]}{offset_str}"
        
        def format(self, record):
            record.asctime = self.formatTime(record)
            return super().format(record)
    
    # Apply unified formatter to all handlers
    formatter = UTCOffsetFormatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s')
    for handler in logging.root.handlers:
        handler.setFormatter(formatter)

setup_unified_logging()

# Rate limiter for repeated warnings
from collections import defaultdict

WARNING_CACHE = defaultdict(lambda: {'count': 0, 'last_logged': 0, 'first_seen': 0})
WARNING_RATE_LIMIT = 5  # seconds between repeated warnings
WARNING_MAX_OCCURRENCES = 3  # max times to show same warning

class RateLimitedWarningFilter(logging.Filter):
    def filter(self, record):
        if record.levelno >= logging.WARNING and hasattr(record, 'msg'):
            msg_key = str(record.msg)[:100]  # Use first 100 chars as key
            now = time.time()
            warning_data = WARNING_CACHE[msg_key]
            
            if warning_data['count'] == 0:
                # First occurrence
                warning_data['first_seen'] = now
                warning_data['last_logged'] = now
                warning_data['count'] = 1
                return True
            elif warning_data['count'] < WARNING_MAX_OCCURRENCES:
                # Allow if enough time passed
                if now - warning_data['last_logged'] >= WARNING_RATE_LIMIT:
                    warning_data['last_logged'] = now
                    warning_data['count'] += 1
                    return True
                else:
                    warning_data['count'] += 1
                    return False
            else:
                # Suppress after max occurrences
                warning_data['count'] += 1
                return False
        return True

# Custom filter to reduce health check noise in logs
class HealthCheckFilter(logging.Filter):
    def filter(self, record):
        # Suppress frequent health check logs
        if hasattr(record, 'msg') and isinstance(record.msg, str):
            message = str(record.msg)
            # Skip health check related logs at INFO level
            if any(pattern in message for pattern in [
                'GET /api/status HTTP',
                'GET /api/health HTTP', 
                'GET /health HTTP',
                'GET /logs?limit=',
                'GET /api/vision/status HTTP'
            ]):
                return False
        return True

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)

# Apply health check filter to werkzeug logger to reduce noise
werkzeug_logger = logging.getLogger('werkzeug')
werkzeug_logger.addFilter(HealthCheckFilter())

# Apply rate limiting to root logger for repeated warnings
root_logger = logging.getLogger()
root_logger.addFilter(RateLimitedWarningFilter())

logger = logging.getLogger('atlas.frontend')

# Add rotating file handler to prevent log growth
LOG_DIR = Path(__file__).parent.parent.parent / 'logs'
LOG_DIR.mkdir(exist_ok=True)
log_file = LOG_DIR / 'frontend.log'

# Create rotating file handler (max 10MB per file, keep 5 backups)
if not any(isinstance(h, RotatingFileHandler) for h in logger.handlers):
    rotating_handler = RotatingFileHandler(
        log_file, 
        maxBytes=10*1024*1024,  # 10MB 
        backupCount=5
    )
    rotating_handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
    rotating_handler.addFilter(HealthCheckFilter())
    rotating_handler.addFilter(RateLimitedWarningFilter())
    logger.addHandler(rotating_handler)

# Get paths
CURRENT_DIR = Path(__file__).parent
TEMPLATE_DIR = CURRENT_DIR / 'templates'
STATIC_DIR = CURRENT_DIR / 'static'
TTS_DIR = CURRENT_DIR.parent.parent / 'ukrainian-tts'

app = Flask(__name__, 
           template_folder=str(TEMPLATE_DIR),
           static_folder=str(STATIC_DIR))

# Disable caching for development (prevent 304 responses)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0
app.config['TEMPLATES_AUTO_RELOAD'] = True

if CORS:
    CORS(app)

# Add no-cache headers for development
@app.after_request
def add_no_cache_headers(response):
    """Add no-cache headers to prevent 304 responses in development"""
    if app.debug:
        response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
        response.headers['Pragma'] = 'no-cache'
        response.headers['Expires'] = '0'
    return response

# Load .env if present (for local development) without failing in prod
try:  # optional dependency
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    pass

# Initialize Goose client (configurable)
GOOSE_BASE_URL = os.environ.get('GOOSE_BASE_URL', 'http://localhost:3000')
GOOSE_SECRET_KEY = os.environ.get('GOOSE_SECRET_KEY', 'test')
goose_client = GooseVisionClient(base_url=GOOSE_BASE_URL, secret_key=GOOSE_SECRET_KEY)

# Configuration
FRONTEND_PORT = int(os.environ.get('FRONTEND_PORT', 5001))
STATUS_CACHE_TTL = float(os.environ.get('STATUS_CACHE_TTL', '1.0'))  # seconds
ORCHESTRATOR_URL = os.environ.get('ORCHESTRATOR_URL', os.environ.get('ATLAS_ORCHESTRATOR_URL', 'http://localhost:5101'))
# Default TTS points to Ukrainian TTS server on port 3001 (can be overridden via env)
TTS_SERVER_URL = os.environ.get('TTS_SERVER_URL', os.environ.get('ATLAS_TTS_URL', 'http://127.0.0.1:3001'))
# Optional: comma-separated list of TTS endpoints for round-robin failover
TTS_SERVER_URLS = os.environ.get('TTS_SERVER_URLS', '')

# Agent voice configuration
AGENT_VOICES = {
    'atlas': {
        'voice': 'dmytro',
        'signature': '[ATLAS]',
        'color': '#00ff00'
    },
    'tetyana': {
        'voice': 'tetiana', 
        'signature': '[ТЕТЯНА]',
        'color': '#00ffff'
    },
    'grisha': {
    'voice': 'mykyta',
        'signature': '[ГРИША]',
        'color': '#ffff00'
    }
}

# Global TTS coordination and HTTP session
tts_lock = Lock()
_voices_cache = {
    'timestamp': 0.0,
    'ttl': 60.0,
    'voices': []
}

def _build_http_session():
    if not requests:
        return None
    s = requests.Session()
    # Timeouts and retries for transient gateway errors
    if HTTPAdapter and Retry:
        retry_strategy = Retry(
            total=3,
            backoff_factor=0.5,
            status_forcelist=[502, 503, 504],
            allowed_methods=["GET", "POST"],
            raise_on_status=False,
        )
        adapter = HTTPAdapter(max_retries=retry_strategy, pool_connections=10, pool_maxsize=10)
        s.mount('http://', adapter)
        s.mount('https://', adapter)
    # Prefer audio back from TTS
    s.headers.update({
        'Accept': 'audio/wav, audio/*;q=0.9, */*;q=0.8',
        'Connection': 'keep-alive'
    })
    return s

http = _build_http_session()

# Multi-endpoint TTS management
_tts_endpoints = []  # list[str]
_tts_index = 0
_tts_failures = {}  # base_url -> cooldown_until (monotonic seconds)

def _init_tts_endpoints():
    global _tts_endpoints, _tts_index
    urls = []
    # Primary from TTS_SERVER_URL always first
    if TTS_SERVER_URL:
        urls.append(TTS_SERVER_URL.strip())
    # Extra URLs from TTS_SERVER_URLS
    if TTS_SERVER_URLS:
        for u in TTS_SERVER_URLS.split(','):
            u = u.strip()
            if u and u not in urls:
                urls.append(u)
    _tts_endpoints = urls or ['http://127.0.0.1:3001']
    _tts_index = 0

_init_tts_endpoints()

def _pick_tts_base() -> str:
    """Pick next healthy TTS base url with simple round-robin and cooldown.
    If all are on cooldown, pick the next in order anyway."""
    global _tts_index
    now = monotonic()
    n = len(_tts_endpoints)
    for i in range(n):
        idx = (_tts_index + i) % n
        base = _tts_endpoints[idx]
        cooldown = _tts_failures.get(base, 0)
        if now >= cooldown:
            _tts_index = (idx + 1) % n
            return base
    # All on cooldown: return next in order
    base = _tts_endpoints[_tts_index]
    _tts_index = (_tts_index + 1) % len(_tts_endpoints)
    return base

def _mark_tts_failure(base: str, backoff: float = 5.0):
    _tts_failures[base] = monotonic() + backoff

def _tts_get(path: str, timeout: int = 5):
    base = _pick_tts_base()
    try:
        # allow longer default timeout for larger voice lists or slower local services
        effective_timeout = max(timeout, 5)
        sess = http or requests
        r = sess.get(f"{base}{path}", timeout=effective_timeout)
        if r.status_code >= 500:
            _mark_tts_failure(base)
        return r, base
    except Exception as e:
        logger.warning(f"TTS GET failed for {base}{path}: {e}")
        _mark_tts_failure(base)
        raise

def _tts_post(path: str, json_payload: dict, timeout: int):
    base = _pick_tts_base()
    try:
        # dynamic minimum timeout to account for long synthesis of long texts
        effective_timeout = max(timeout, 10)
        sess = http or requests
        r = sess.post(f"{base}{path}", json=json_payload, timeout=effective_timeout)
        if r.status_code >= 500:
            _mark_tts_failure(base)
        return r, base
    except Exception as e:
        logger.warning(f"TTS POST failed for {base}{path}: {e}")
        _mark_tts_failure(base)
        raise

def _dynamic_timeout_for_text(text: str) -> int:
    # ~60ms per char with floor/ceiling
    n = max(1, len(text))
    seconds = min(45, max(10, int(0.06 * n + 5)))
    return seconds

def _get_supported_voices(force: bool = False) -> list:
    now = monotonic()
    if not force and _voices_cache['voices'] and (now - _voices_cache['timestamp'] < _voices_cache['ttl']):
        return _voices_cache['voices']
    if not requests:
        return []
    try:
        r, base = _tts_get("/voices", timeout=5)
        if r.status_code == 200:
            payload = r.json()
            # Normalize payload to list of dicts with at least 'name' and optional 'locale'
            if isinstance(payload, dict):
                raw_voices = payload.get('voices', [])
            elif isinstance(payload, list):
                raw_voices = payload
            else:
                raw_voices = []

            voices = []
            for v in raw_voices:
                if isinstance(v, dict):
                    name = v.get('name') or v.get('id') or v.get('voice')
                    if not name and len(v) == 1:
                        # single-key dict
                        name = list(v.values())[0]
                    if name:
                        voices.append({'name': str(name), 'locale': v.get('locale') or v.get('lang') or ''})
                elif isinstance(v, str):
                    voices.append({'name': v, 'locale': ''})
            _voices_cache['voices'] = voices
            _voices_cache['timestamp'] = now
            return voices
    except Exception as e:
        logger.warning(f"Fetching supported voices failed: {e}")
    return _voices_cache['voices'] or []

def _sanitize_voice(agent: str, requested: Optional[str]) -> str:
    agent_default = AGENT_VOICES.get(agent, {}).get('voice', 'dmytro')
    voice = (requested or agent_default).strip()
    supported = _get_supported_voices()
    if supported:
        names = {v.get('name') for v in supported if isinstance(v, dict)}
        if voice not in names:
            # Try agent default, then fall back to any uk voice, else any, else dmytro
            if agent_default in names:
                voice = agent_default
            else:
                uk_candidates = [v.get('name') for v in supported if isinstance(v, dict) and str(v.get('locale', '')).startswith('uk')]
                voice = (uk_candidates[0] if uk_candidates else (next(iter(names)) if names else 'dmytro'))
    return voice

def _make_silence_wav(duration_ms: int = 400) -> io.BytesIO:
    sr = 22050
    frames = int(sr * duration_ms / 1000)
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit PCM
        wf.setframerate(sr)
        wf.writeframes(b"\x00\x00" * frames)
    buf.seek(0)
    return buf

@app.route('/')
def index():
    """Serve the main interface"""
    # Add cache busting timestamp for development
    cache_bust = int(time.time()) if app.debug else ""
    return render_template('index.html', 
                         current_time=datetime.now().strftime('%H:%M:%S'),
                         cache_bust=cache_bust)

@app.route('/api/health')
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'timestamp': datetime.now().isoformat(),
        'services': {
            'frontend': 'running',
            'orchestrator': check_orchestrator_health(),
            'tts': check_tts_health()
        }
    })

@app.route('/api/clear-cache')
def clear_cache():
    """Clear browser cache endpoint for development"""
    response = jsonify({
        'status': 'cache_cleared',
        'timestamp': datetime.now().isoformat(),
        'message': 'Browser cache headers reset'
    })
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response

@app.route('/.well-known/appspecific/com.chrome.devtools.json')
def chrome_devtools():
    """Handle Chrome DevTools request to prevent 404"""
    return jsonify({'status': 'not_applicable'}), 404

@app.route('/logs')
def get_logs():
    """Get system logs"""
    try:
        limit = int(request.args.get('limit', 100))

        # Read and normalize logs from multiple sources
        logs = []
        log_files = [
            '../logs/frontend.log',
            '../logs/orchestrator.log',
            '../logs/recovery_bridge.log'
        ]

        # Timestamp patterns we support:
        # 1) 2025-09-04 20:19:54,360
        ts_pat_1 = re.compile(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})')
        # 2) [2025-09-05T00:23:19.735Z] ...
        ts_pat_2 = re.compile(r'^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]')
        # 3) 03:13:48 or 03:13:48.123 (time-only)
        ts_pat_3 = re.compile(r'^(\d{2}:\d{2}:\d{2}(?:[\.,]\d{1,3})?)')
        # Levels
        lvl_pat = re.compile(r'\[(DEBUG|INFO|WARN|WARNING|ERROR|CRITICAL|TRACE)\]', re.IGNORECASE)

        def parse_ts(ts_str: str):
            """Return (iso_str, sort_key_dt) from known formats; fallback to now."""
            now_dt = datetime.now()
            # 2025-09-04 20:19:54,360
            try:
                if 'T' not in ts_str and ',' in ts_str:
                    dt = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S,%f')
                    return dt.isoformat(timespec='milliseconds'), dt
            except Exception:
                pass
            # ISO in brackets e.g. 2025-09-05T00:23:19.735Z
            try:
                iso = ts_str.replace('Z', '+00:00')
                dt = datetime.fromisoformat(iso)
                return dt.isoformat(timespec='milliseconds'), dt
            except Exception:
                pass
            # Time-only: 03:13:48(.123)
            try:
                # Normalize decimal separator
                ts_norm = ts_str.replace(',', '.')
                fmt = '%H:%M:%S.%f' if '.' in ts_norm else '%H:%M:%S'
                t = datetime.strptime(ts_norm, fmt).time()
                dt = datetime.combine(now_dt.date(), t)
                return dt.isoformat(timespec='milliseconds'), dt
            except Exception:
                pass
            # Fallback
            return now_dt.isoformat(timespec='milliseconds'), now_dt

        for log_file in log_files:
            log_path = CURRENT_DIR.parent / log_file.replace('../', '')
            if not log_path.exists():
                continue
            try:
                with open(log_path, 'r') as f:
                    # Read a bit more to allow multi-line grouping
                    raw_lines = [ln.rstrip('\n') for ln in f.readlines()[-max(limit * 4, 200):]]

                source = log_path.name.replace('.log', '')
                current = None  # current aggregated entry

                def push_current():
                    nonlocal current
                    if current and current.get('message'):
                        logs.append({
                            'timestamp': current['timestamp_iso'],
                            'source': source,
                            'level': current['level'],
                            'message': current['message']
                        })
                    current = None

                for line in raw_lines:
                    text = line.strip('\r')
                    if not text:
                        # keep empty lines as part of the message if we have one
                        if current:
                            current['message'] += '\n'
                        continue

                    # Detect timestamp
                    ts_iso = None
                    ts_dt = None
                    ts_match = ts_pat_1.match(text) or ts_pat_2.match(text) or ts_pat_3.match(text)
                    if ts_match:
                        ts_iso, ts_dt = parse_ts(ts_match.group(1))

                    # Detect level
                    level = 'info'
                    m_lvl = lvl_pat.search(text)
                    if m_lvl:
                        level = m_lvl.group(1).lower()
                        if level == 'warning':
                            level = 'warn'
                    else:
                        low = text.lower()
                        if ' error' in low or low.startswith('error'):
                            level = 'error'
                        elif ' warn' in low or low.startswith('warn'):
                            level = 'warn'
                        elif ' debug' in low or low.startswith('debug'):
                            level = 'debug'

                    # New entry if has timestamp, else continuation
                    if ts_iso is not None:
                        push_current()
                        current = {
                            'timestamp_iso': ts_iso,
                            'timestamp_dt': ts_dt,
                            'level': level,
                            'message': text
                        }
                    else:
                        # Continuation: append to previous entry if exists, else create minimal
                        if current is None:
                            ts_iso, ts_dt = parse_ts('')
                            current = {
                                'timestamp_iso': ts_iso,
                                'timestamp_dt': ts_dt,
                                'level': level,
                                'message': text
                            }
                        else:
                            # Append with newline to keep multi-line structure (e.g., markdown like "### [ТЕТЯНА]")
                            current['message'] += f"\n{text}"

                # push the last aggregated entry for this source
                push_current()
            except Exception as e:
                logger.warning(f"Failed to read {log_file}: {e}")

        # Sort by timestamp (we normalized to ISO for strings, but sorting by ISO may still be off for time-only)
        # To be safe, convert back to dt for sorting where possible
        def sort_key(item):
            try:
                return datetime.fromisoformat(item['timestamp'])
            except Exception:
                return datetime.now()

        logs.sort(key=sort_key)
        return jsonify({'logs': logs[-limit:]})
    except Exception as e:
        logger.error(f"Error getting logs: {e}")
        return jsonify({'error': 'Failed to get logs', 'logs': []}), 500

@app.route('/api/unified-logs')
def get_unified_logs():
    """Get unified logs using centralized logging system"""
    try:
        import subprocess
        import os
        
        tail_count = int(request.args.get('tail', 20))
        
        # Читаємо unified log файл напряму
        unified_log_path = os.path.join(os.path.dirname(__file__), '../../logs/atlas_unified.log')
        if not os.path.exists(unified_log_path):
            return jsonify({'error': 'Unified log not available', 'logs': []}), 404
            
        # Використовуємо tail для отримання останніх записів
        result = subprocess.run([
            'tail', '-n', str(tail_count), unified_log_path
        ], capture_output=True, text=True, timeout=3, cwd=os.path.dirname(unified_log_path))
        
        if result.returncode != 0:
            return jsonify({'error': 'Failed to get unified logs', 'logs': []}), 500
            
        # Розбиваємо output на рядки і фільтруємо порожні
        log_lines = [line.strip() for line in result.stdout.split('\n') if line.strip()]
        
        return jsonify({'logs': log_lines})
        
    except subprocess.TimeoutExpired:
        return jsonify({'error': 'Timeout getting unified logs', 'logs': []}), 408
    except Exception as e:
        logger.error(f"Error getting unified logs: {e}")
        return jsonify({'error': 'Failed to get unified logs', 'logs': []}), 500

@app.route('/api/voice/health')
def voice_health():
    """Check voice/TTS health status"""
    try:
        tts_status = check_tts_health()
        return jsonify({
            'success': True,
            'status': tts_status,
            'timestamp': datetime.now().isoformat(),
            'tts_url': TTS_SERVER_URL,
            'backends': _tts_endpoints,
            'available': tts_status == 'running'
        })
    except Exception as e:
        logger.error(f"Error checking voice health: {e}")
        return jsonify({'success': False, 'status': 'error', 'available': False}), 500

@app.route('/api/agents')
def get_agents():
    """Get agent configuration"""
    return jsonify(AGENT_VOICES)

@app.route('/api/agents/tetyana', methods=['POST'])
def chat_with_tetyana():
    """Direct chat with Tetyana via Goose"""
    try:
        data = request.get_json()
        message = data.get('message', '')
        session_id = data.get('sessionId', 'atlas_session')
        
        if not message.strip():
            return jsonify({'error': 'Message cannot be empty'}), 400
        
        # Send message to Goose (Tetyana)
        result = goose_client.send_reply(session_id, message)
        
        if result.get('success'):
            response_text = result.get('response', '')
            return jsonify({
                'success': True,
                'response': [{
                    'role': 'assistant',
                    'content': f'[ТЕТЯНА] {response_text}',
                    'agent': 'tetyana',
                    'voice': 'tetiana',
                    'color': '#00ffff',
                    'timestamp': datetime.now().isoformat()
                }],
                'session': {
                    'id': session_id,
                    'currentAgent': 'tetyana'
                }
            })
        else:
            error_msg = result.get('error', 'Unknown error')
            logger.error(f"Goose client error: {error_msg}")
            return jsonify({
                'success': False,
                'error': f'Tetyana is unavailable: {error_msg}',
                'fallback_response': [{
                    'role': 'assistant',
                    'content': '[ATLAS] Тетяна тимчасово недоступна. Перевірте з\'єднання з Goose.',
                    'agent': 'atlas',
                    'voice': 'dmytro',
                    'color': '#00ff00'
                }]
            }), 503
            
    except Exception as e:
        logger.error(f"Tetyana chat error: {e}")
        return jsonify({
            'success': False,
            'error': 'Internal error',
            'fallback_response': [{
                'role': 'assistant', 
                'content': '[ATLAS] Помилка зв\'язку з Тетяною. Спробуйте пізніше.',
                'agent': 'atlas',
                'voice': 'dmytro',
                'color': '#00ff00'
            }]
        }), 500

@app.route('/api/chat', methods=['POST'])
def chat():
    """Main chat endpoint: pure proxy to orchestrator for unified LLM intent and replies"""
    try:
        data = request.get_json(silent=True) or {}
        message = data.get('message', '')
        session_id = data.get('sessionId', 'default')
        user_id = data.get('userId', 'user')
        ack_mode = data.get('ackMode', False) or request.headers.get('X-Atlas-Ack') == 'immediate'

        # --- Diagnostic logging (helps detect why UI sends nothing) ---
        try:
            logger.info(f"/api/chat received session={session_id} user={user_id} ack={ack_mode} msg_len={len(message)}")
        except Exception:
            pass

        if not message.strip():
            return jsonify({'error': 'Message cannot be empty'}), 400

        if not requests:
            return jsonify({'error': 'Requests module unavailable'}), 500

        # ACK mode: return immediate acceptance, then process async
        if ack_mode:
            client_message_id = data.get('clientMessageId') or f"py_ack_{uuid.uuid4().hex}"
            
            # Try immediate ACK from orchestrator
            try:
                logger.info(f"/api/chat ACK mode forwarding to orchestrator session={session_id}")
                ack_response = requests.post(
                    f'{ORCHESTRATOR_URL}/chat/stream',
                    json={'message': message, 'sessionId': session_id, 'userId': user_id, 'clientMessageId': client_message_id},
                    headers={'X-Atlas-Ack': 'immediate'},
                    timeout=5
                )
                if ack_response.status_code == 200:
                    ack_data = ack_response.json()
                    if ack_data.get('accepted'):
                        logger.info(f"/api/chat ACK accepted by orchestrator session={session_id} clientMessageId={client_message_id}")
                        return jsonify({
                            'success': True,
                            'accepted': True,
                            'clientMessageId': client_message_id,
                            'session': {'id': session_id},
                            'message': 'Processing started. Use /api/chat/status or SSE to monitor progress.',
                            'ackMode': True
                        })
            except Exception as e:
                logger.warning(f"ACK mode failed, falling back to sync: {e}")

        # Use a longer timeout and a small retry loop for local orchestrator which may be busy
        post_url = f'{ORCHESTRATOR_URL}/chat/stream'
        last_exc = None
        response = None
        # Dynamic timeout logic: compute needed time based on message complexity instead of fixed large timeout
        def compute_orchestrator_timeout(msg: str) -> int:
            base_s = int(os.environ.get('ORCH_POST_BASE_TIMEOUT', '20'))  # increased for model rotation delays
            max_s = int(os.environ.get('ORCH_POST_MAX_TIMEOUT', os.environ.get('ORCH_POST_TIMEOUT', '180')))  # increased to 3 minutes for heavy rotation
            per_char_ms = float(os.environ.get('ORCH_POST_PER_CHAR_MS', '6'))  # ms per char heuristic
            # Complexity boosts
            length = len(msg)
            est_ms = base_s * 1000 + length * per_char_ms
            # Code / structured content tends to require more planning
            if '```' in msg or '{' in msg or '[' in msg:
                est_ms *= 1.3
            # Cap + floor
            est_s = max(base_s, min(max_s, math.ceil(est_ms / 1000)))
            return est_s

        orch_timeout = compute_orchestrator_timeout(message)
        max_attempts = int(os.environ.get('ORCH_POST_RETRIES', '2'))
        client_message_id = data.get('clientMessageId') or f"py_{uuid.uuid4().hex}"
        for attempt in range(1, max_attempts + 1):
            try:
                if attempt == 1:
                    logger.info(f"/api/chat forwarding to orchestrator session={session_id} timeout={orch_timeout}s clientMessageId={client_message_id}")
                else:
                    logger.info(f"/api/chat retry attempt={attempt} session={session_id} timeout={orch_timeout}s")
                extra_headers = {}
                response = requests.post(
                    post_url,
                    json={'message': message, 'sessionId': session_id, 'userId': user_id, 'clientMessageId': client_message_id},
                    headers=extra_headers or None,
                    timeout=orch_timeout
                )
                break
            except Exception as e:
                last_exc = e
                logger.warning(f"Orchestrator POST attempt {attempt} failed after timeout={orch_timeout}s: {e}")
                if attempt < max_attempts:
                    time.sleep(min(2 ** attempt, 6))
                    orch_timeout = min(int(orch_timeout * 1.25), int(os.environ.get('ORCH_POST_MAX_TIMEOUT', '180')))

        if response is None:
            logger.error(f"Orchestrator unreachable after retries: {last_exc}")
            return jsonify({'error': 'Orchestrator unreachable', 'details': str(last_exc)}), 503
        if response.status_code == 200:
            logger.info(f"/api/chat orchestrator OK session={session_id} status=200")
            return jsonify(response.json())
        else:
            logger.error(f"/api/chat orchestrator error status={response.status_code} session={session_id}")
            return jsonify({'error': 'Orchestrator error'}), response.status_code

    except Exception as e:
        if requests and hasattr(e, '__class__') and 'RequestException' in str(e.__class__):
            logger.error(f"Orchestrator connection failed: {e}")
            return jsonify({'error': 'Service unavailable'}), 503
        else:
            logger.error(f"Chat processing error: {e}")
            return jsonify({'error': 'Internal error'}), 500

@app.route('/api/chat/status/<session_id>')
def chat_status(session_id):
    """Get processing status for ACK mode"""
    try:
        if not requests:
            return jsonify({'error': 'Requests module unavailable'}), 500
            
        # Query orchestrator for session status
        try:
            response = requests.get(f'{ORCHESTRATOR_URL}/session/{session_id}/status', timeout=5)
            if response.status_code == 200:
                return jsonify(response.json())
            else:
                return jsonify({
                    'sessionId': session_id,
                    'status': 'unknown',
                    'ready': False,
                    'error': f'Orchestrator returned {response.status_code}'
                }), response.status_code
        except Exception as e:
            logger.warning(f"Session status check failed: {e}")
            return jsonify({
                'sessionId': session_id,
                'status': 'unavailable',
                'ready': False,
                'error': str(e)
            }), 503
            
    except Exception as e:
        logger.error(f"Chat status error: {e}")
        return jsonify({'error': 'Internal error'}), 500

@app.route('/api/voice/synthesize', methods=['POST'])
def synthesize_voice():
    """TTS synthesis endpoint"""
    try:
        data = request.get_json()
        text = data.get('text', '')
        agent = data.get('agent', 'atlas')
        req_voice = data.get('voice')
        req_fx = data.get('fx')
        req_rate = data.get('rate')  # 1.0 по умолчанию
        req_speed = data.get('speed')  # совместимость, приоритетнее, если задано
        
        if not text.strip():
            return jsonify({'error': 'Text is required'}), 400
            
        if agent not in AGENT_VOICES:
            return jsonify({'error': f'Unknown agent: {agent}'}), 400
            
        # Базовые значения по агенту
        agent_defaults = AGENT_VOICES.get(agent, {})
        voice_name = req_voice or agent_defaults.get('voice', 'dmytro')
        fx = req_fx
        if fx is None:
            # Попробуем получить из /api/voice/agents маппинга — по умолчанию none
            fx = 'none'
        # Преобразуем rate -> speed (простое соответствие)
        speed = float(req_speed if req_speed is not None else (req_rate if req_rate is not None else 1.0))
        
        # Try Ukrainian TTS server with retries, sanitization and dynamic timeout
        if requests:
            acquired = tts_lock.acquire(timeout=30)
            if not acquired:
                logger.warning("TTS busy: lock acquire timeout")
                # Return a short silence to keep pipeline flowing without throwing 502
                silence = _make_silence_wav(250)
                resp = make_response(send_file(silence, mimetype='audio/wav', as_attachment=False,
                                               download_name=f'{agent}_busy_silent.wav'))
                resp.headers['X-TTS-Fallback'] = 'busy-silence'
                resp.headers['Cache-Control'] = 'no-store'
                return resp
            try:
                started = monotonic()
                voice_name = _sanitize_voice(agent, voice_name)
                # Build payload, omit optional fields when not needed
                tts_payload = {
                    'text': text,
                    'voice': voice_name,
                    'speed': float(max(0.5, min(1.5, speed))),
                    'return_audio': True
                }
                if req_fx and str(req_fx).lower() != 'none':
                    tts_payload['fx'] = req_fx

                timeout_sec = _dynamic_timeout_for_text(text)
                tts_response, base = _tts_post('/tts', tts_payload, timeout=timeout_sec)
                elapsed = monotonic() - started
                if tts_response.status_code == 200 and tts_response.content:
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
                        temp_file.write(tts_response.content)
                        temp_path = temp_file.name
                    logger.info(f"TTS OK [{voice_name}] in {elapsed:.2f}s, size={len(tts_response.content)} bytes")
                    resp = make_response(send_file(temp_path, mimetype='audio/wav', as_attachment=False,
                                                   download_name=f'{agent}_{int(datetime.now().timestamp())}.wav'))
                    resp.headers['Cache-Control'] = 'no-store'
                    return resp
                else:
                    logger.warning(f"TTS server HTTP {tts_response.status_code} from {base}: {tts_response.text[:200] if hasattr(tts_response, 'text') else 'no text'}")
            except Exception as e:
                logger.warning(f"TTS server request failed: {e}")
            finally:
                try:
                    tts_lock.release()
                except Exception:
                    pass

        # Safe fallback: return a short silent WAV to avoid client 502 handling and keep UI smooth
        silence = _make_silence_wav(300)
        resp = make_response(send_file(silence, mimetype='audio/wav', as_attachment=False,
                                       download_name=f'{agent}_silent.wav'))
        resp.headers['X-TTS-Fallback'] = 'silent'
        resp.headers['Cache-Control'] = 'no-store'
        return resp
        
    except Exception as e:
        logger.error(f"TTS synthesis error: {e}")
        return jsonify({'error': 'TTS synthesis failed'}), 500

@app.route('/api/voice/interrupt', methods=['POST'])
def handle_voice_interrupt():
    """Handle user voice interruptions"""
    try:
        data = request.get_json()
        transcript = data.get('transcript', '')
        session_id = data.get('sessionId', 'default')
        confidence = data.get('confidence', 0)
        
        # Detect interruption intent
        interrupt_keywords = [
            'стоп', 'stop', 'чекай', 'wait', 'припини', 'pause',
            'наказую', 'command', 'я наказую', 'слухайте'
        ]
        
        transcript_lower = transcript.lower()
        is_interruption = any(keyword in transcript_lower for keyword in interrupt_keywords)
        
        if is_interruption:
            # Forward interruption to orchestrator
            if requests:
                try:
                    response = requests.post(f'{ORCHESTRATOR_URL}/chat/stream',
                                           json={
                                               'message': transcript,
                                               'sessionId': session_id,
                                               'userId': 'user',
                                               'type': 'voice_interruption'
                                           },
                                           timeout=10)
                    
                    return jsonify({
                        'success': True,
                        'interruption_detected': True,
                        'transcript': transcript,
                        'action': 'interrupt',
                        'response': response.json() if response.status_code == 200 else None
                    })
                except Exception:
                    pass
            
            # Fallback response
            return jsonify({
                'success': True,
                'interruption_detected': True,
                'transcript': transcript,
                'action': 'interrupt',
                'response': {
                    'success': True,
                    'message': f'Interruption processed: {transcript}',
                    'shouldPause': True
                }
            })
        
        return jsonify({
            'success': True,
            'interruption_detected': False,
            'transcript': transcript,
            'action': 'continue'
        })
        
    except Exception as e:
        logger.error(f"Voice interruption handling error: {e}")
        return jsonify({'error': 'Voice interruption handling failed'}), 500

_STATUS_CACHE = {'data': None, 'ts': 0.0}

@app.route('/api/status')
def status():
    """Status endpoint (1s cache to reduce health probe load)."""
    now = time.time()
    cached = _STATUS_CACHE['data']
    if cached and (now - _STATUS_CACHE['ts'] < STATUS_CACHE_TTL):
        return jsonify(cached)

    recovery_status = check_recovery_bridge_health()
    orch_status = check_orchestrator_health()
    tts_status = check_tts_health()
    goose_status = check_goose_health()
    vision_status = check_vision_health()

    payload = {
        'timestamp': datetime.now().isoformat(),
        'cached': False,
        'processes': {
            'frontend': {'count': 1, 'status': 'running'},
            'orchestrator': {'count': 1 if orch_status == 'running' else 0, 'status': orch_status},
            'recovery': {'count': 1 if recovery_status == 'running' else 0, 'status': recovery_status},
            'tts': {'count': 1 if tts_status == 'running' else 0, 'status': tts_status},
            'goose': {'count': 1 if goose_status == 'running' else 0, 'status': goose_status},
            'vision': {'count': 1 if vision_status == 'running' else 0, 'status': vision_status}
        },
        'memory': {'usage': 50},
        'network': {'active': True}
    }
    _STATUS_CACHE['data'] = payload
    _STATUS_CACHE['ts'] = now
    return jsonify(payload)

@app.route('/api/metrics')
def metrics():
    """Aggregated lightweight metrics (JSON) for monitoring panels."""
    # Reuse (maybe cached) status
    status_payload = _STATUS_CACHE['data']
    now = time.time()
    if not status_payload or (now - _STATUS_CACHE['ts'] >= STATUS_CACHE_TTL):
        # force refresh by calling status() (will populate cache)
        status().get_json()
        status_payload = _STATUS_CACHE['data'] or {}

    proc = status_payload.get('processes', {}) if isinstance(status_payload, dict) else {}
    metrics = {
        'timestamp': datetime.now().isoformat(),
        'uptime_seconds': max(0, int(now - _STATUS_CACHE['ts'])),
        'services_running': sum(1 for v in proc.values() if v.get('status') == 'running'),
        'goose_status': proc.get('goose', {}).get('status'),
        'tts_status': proc.get('tts', {}).get('status'),
        'orchestrator_status': proc.get('orchestrator', {}).get('status'),
        'vision_status': proc.get('vision', {}).get('status'),
        'cache_ttl_seconds': STATUS_CACHE_TTL,
        'cache_age_seconds': round(now - _STATUS_CACHE['ts'], 3),
    }
    return jsonify(metrics)

@app.route('/api/system/status')
def system_status():
    """Get complete system status"""
    return jsonify({
        'timestamp': datetime.now().isoformat(),
        'services': {
            'frontend': {
                'status': 'running',
                'port': FRONTEND_PORT,
                'version': '2.0'
            },
            'orchestrator': {
                'status': check_orchestrator_health(),
                'url': ORCHESTRATOR_URL
            },
            'tts': {
                'status': check_tts_health(),
                'url': TTS_SERVER_URL
            }
        },
        'agents': AGENT_VOICES
    })

@app.route('/api/voice/agents')
def voice_agents():
    """Return voice mapping for agents and available voices with uk-UA locale"""
    try:
        voices_list = []
        if requests:
            try:
                r, base = _tts_get("/voices", timeout=5)
                if r.status_code == 200:
                    payload = r.json()
                    if isinstance(payload, dict):
                        raw = payload.get('voices', [])
                    else:
                        raw = payload if isinstance(payload, list) else []
                    # Normalize
                    tmp = []
                    for v in raw:
                        if isinstance(v, dict):
                            name = v.get('name') or v.get('id') or v.get('voice')
                            if not name and len(v) == 1:
                                name = list(v.values())[0]
                            if name:
                                tmp.append({'name': str(name), 'locale': v.get('locale') or v.get('lang') or ''})
                        elif isinstance(v, str):
                            tmp.append({'name': v, 'locale': ''})
                    voices_list = tmp
            except Exception as e:
                logger.warning(f"Failed to fetch voices: {e}")
        agents = {
            'atlas': { **AGENT_VOICES.get('atlas', {}), 'lang': 'uk-UA', 'fx': 'none', 'rate': 1.0, 'pitch': 1.0 },
            'tetyana': { **AGENT_VOICES.get('tetyana', {}), 'lang': 'uk-UA', 'fx': 'none', 'rate': 1.0, 'pitch': 1.05 },
            # Для українського TTS використовуємо голос 'mykyta' та вимикаємо спец-ефекти
            'grisha': { **AGENT_VOICES.get('grisha', {}), 'lang': 'uk-UA', 'fx': 'none', 'rate': 1.1, 'pitch': 0.9 }
        }
        return jsonify({
            'success': True,
            'agents': agents,
            'availableVoices': voices_list,
            'locale': 'uk-UA'
        })
    except Exception as e:
        logger.error(f"Error building voice agents: {e}")
        return jsonify({'success': False, 'error': 'Failed to build agents'}), 500

@app.route('/api/voice/prepare_response', methods=['POST'])
def voice_prepare_response():
    """Prepare voice response: detect agent, strip signatures, and normalize text.
    Input JSON: { text: str }
    Output JSON: { success: bool, text: str, agent: str, signature: str }
    """
    try:
        data = request.get_json(force=True) or {}
        raw = str(data.get('text') or '').strip()
        if not raw:
            return jsonify({'success': False, 'error': 'Text is required'}), 400

        # Detect agent by explicit signature like [ATLAS], [ТЕТЯНА], [ГРИША] or by name:
        lowered = raw.lower()
        agent = 'atlas'
        if re.search(r'\[(тетр?яна|tetyana)\]', lowered) or lowered.startswith('[т') or 'тетяна' in lowered:
            agent = 'tetyana'
        elif re.search(r'\[(гриша|grisha)\]', lowered) or 'гриша' in lowered:
            agent = 'grisha'
        elif re.search(r'\[(atlas)\]', lowered) or 'atlas' in lowered:
            agent = 'atlas'

        # Extract only VOICE-lines for Tetyana if present
        prepared = raw
        if agent == 'tetyana':
            lines = raw.splitlines()
            voice_lines = []
            for ln in lines:
                m1 = re.match(r'^\s*\[VOICE\]\s*(.+)$', ln, flags=re.IGNORECASE)
                m2 = re.match(r'^\s*VOICE\s*:\s*(.+)$', ln, flags=re.IGNORECASE)
                if m1:
                    voice_lines.append(m1.group(1).strip())
                elif m2:
                    voice_lines.append(m2.group(1).strip())
            if voice_lines:
                prepared = ' '.join(voice_lines).strip()
        
        # Strip leading signatures like [ATLAS] or NAME:
        prepared = re.sub(r'^\s*\[[^\]]+\]\s*', '', prepared)
        prepared = re.sub(r'^\s*[A-ZА-ЯІЇЄҐ]+\s*:\s*', '', prepared)
        prepared = prepared.strip()

        # Clamp to a reasonable maximum to avoid overlong TTS requests
        if len(prepared) > 2000:
            prepared = prepared[:2000]

        sig = AGENT_VOICES.get(agent, {}).get('signature', '[ATLAS]')
        return jsonify({
            'success': True,
            'text': prepared,
            'agent': agent,
            'signature': sig
        })
    except Exception as e:
        logger.error(f"/api/voice/prepare_response error: {e}")
        return jsonify({'success': False, 'error': 'Failed to prepare response'}), 500

def check_orchestrator_health():
    """Check if orchestrator is responding"""
    if not requests:
        return 'unavailable'
    try:
        response = requests.get(f'{ORCHESTRATOR_URL}/health', timeout=5)
        return 'running' if response.status_code == 200 else 'error'
    except:
        return 'stopped'

def check_tts_health():
    """Check if TTS server is responding"""
    if not requests:
        return 'fallback'
    try:
        # Try multiple backends quickly
        for _ in range(len(_tts_endpoints)):
            try:
                r, base = _tts_get('/health', timeout=3)
                if r.status_code == 200:
                    return 'running'
            except Exception:
                continue
        return 'error'
    except:
        return 'fallback'  # Can use browser TTS

def check_goose_health():
    """Check if Goose web server is responding.
    Accept conditions:
      - 200 on '/health'
      - 200 on '/' (legacy root-only)
      - 404 on '/health' but 200 on '/' (treat as running)
    """
    if not requests:
        return 'unavailable'
    root_ok = False
    try:
        try:
            r_root = requests.get('http://localhost:3000/', timeout=2)
            root_ok = (r_root.status_code == 200)
        except Exception:
            root_ok = False
        try:
            r_health = requests.get('http://localhost:3000/health', timeout=2)
            if r_health.status_code == 200:
                return 'running'
            if r_health.status_code == 404 and root_ok:
                return 'running'
            return 'error'
        except Exception:
            return 'running' if root_ok else 'stopped'
    except Exception:
        return 'stopped'

def check_recovery_bridge_health():
    """Check if Recovery Bridge is responding"""
    if not requests:
        return 'unavailable'
    try:
        response = requests.get('http://localhost:5103/health', timeout=3)
        return 'running' if response.status_code == 200 else 'error'
    except:
        return 'stopped'

def check_vision_health():
    """Check if Vision system (Grisha monitoring) is available"""
    try:
        # Vision system is integrated into this Flask app
        # Check if vision_processor module is importable and functional
        import importlib.util
        spec = importlib.util.find_spec('vision_processor')
        if spec is not None:
            return 'running'
        else:
            return 'warning'
    except:
        return 'warning'


@app.route('/api/translate', methods=['POST'])
def translate_api():
    """Lightweight translation endpoint (en->uk by default). Uses Goose as a stub if available.
    Body: { text: str, source?: str, target?: str }
    """
    try:
        data = request.get_json(force=True) or {}
        text = data.get('text', '')
        source = (data.get('source') or '').lower() or 'auto'
        target = (data.get('target') or '').lower() or 'uk'
        if not text.strip():
            return jsonify({'success': False, 'error': 'Text is required'}), 400

        # For now, perform a no-op for non-English or already Ukrainian, to avoid bad machine output
        if target.startswith('uk') and (source == 'uk' or 'а' in text or 'і' in text or 'є' in text or 'ї' in text):
            return jsonify({'success': True, 'text': text, 'detected': 'uk'})

        # Try Goose paraphrase to Ukrainian (placeholder). If unavailable, return original.
        try:
            prompt = f"Переклади українською коротко і природно: {text}"
            result = goose_client.send_reply('atlas_translate', prompt)
            if result.get('success'):
                return jsonify({'success': True, 'text': result.get('response', text), 'detected': source or 'auto'})
        except Exception as e:
            logger.warning(f"Translate via Goose failed: {e}")

        return jsonify({'success': True, 'text': text, 'detected': source or 'auto', 'note': 'noop'}), 200
    except Exception as e:
        logger.error(f"/api/translate error: {e}")
        return jsonify({'success': False, 'error': 'Translation failed'}), 500

# ========== STT (Speech-to-Text) Endpoints ==========

@app.route('/api/stt/status', methods=['GET'])
def stt_status():
    """Повертає статус STT системи."""
    try:
        status = stt_manager.get_status()
        return jsonify(status)
    except Exception as e:
        logger.error(f"/api/stt/status error: {e}")
        return jsonify({'error': 'STT status check failed'}), 500

@app.route('/api/stt/transcribe', methods=['POST'])
def stt_transcribe():
    """Транскрибує аудіофайл за допомогою Whisper."""
    try:
        # Перевіряємо наявність файлу
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file uploaded'
            }), 400

        file = request.files['file']
        
        # Перевіряємо, чи файл не порожній
        if file.filename == '':
            return jsonify({
                'success': False, 
                'error': 'No file selected'
            }), 400

        # Перевіряємо підтримку формату
        if not stt_manager.allowed_file(file.filename):
            return jsonify({
                'success': False,
                'error': f'Unsupported file format. Supported: {", ".join(stt_manager.allowed_extensions)}'
            }), 400

        # Перевіряємо доступність Whisper
        if not stt_manager.is_whisper_available():
            return jsonify({
                'success': False,
                'error': 'Whisper not available. Please install faster-whisper.',
                'fallback': 'Use Web Speech API on client side'
            }), 503

        # Створюємо тимчасовий файл
        temp_file = tempfile.NamedTemporaryFile(
            suffix=f".{file.filename.rsplit('.', 1)[1].lower()}",
            delete=False
        )
        
        try:
            # Зберігаємо файл
            file.save(temp_file.name)
            
            # Отримуємо параметри з форми
            # Якщо мова не задана клієнтом, дефолтимо на українську ('uk')
            language = request.form.get('language') or 'uk'
            beam_size = int(request.form.get('beam_size', 5))
            temperature = float(request.form.get('temperature', 0.0))
            optimize_for_mobile = request.form.get('optimize_for_mobile', 'false').lower() == 'true'
            
            # Виконуємо транскрибацію з мобільними оптимізаціями
            result = stt_manager.transcribe_file(
                temp_file.name,
                language=language,
                beam_size=beam_size,
                temperature=temperature,
                optimize_for_mobile=optimize_for_mobile
            )
            
            return jsonify(result)
            
        finally:
            # Видаляємо тимчасовий файл
            try:
                os.unlink(temp_file.name)
            except OSError:
                pass
                
    except Exception as e:
        logger.error(f"/api/stt/transcribe error: {e}")
        return jsonify({
            'success': False,
            'error': f'Transcription failed: {str(e)}'
        }), 500

@app.route('/api/stt/models', methods=['GET'])
def stt_models():
    """Повертає інформацію про доступні STT моделі."""
    try:
        available_models = [
            'tiny', 'tiny.en',
            'base', 'base.en', 
            'small', 'small.en',
            'medium', 'medium.en',
            'large-v1', 'large-v2', 'large-v3'
        ]
        
        return jsonify({
            'whisper_available': stt_manager.is_whisper_available(),
            'current_model': stt_manager.model_size if stt_manager.is_whisper_available() else None,
            'available_models': available_models,
            'device': stt_manager.device,
            'compute_type': getattr(stt_manager, 'compute_type', None),
            'web_speech_available': True  # Завжди доступний у браузері
        })
    except Exception as e:
        logger.error(f"/api/stt/models error: {e}")
        return jsonify({'error': 'Failed to get models info'}), 500

@app.route('/api/intent', methods=['POST'])
def intent_classification():
    """Intent router proxy endpoint for orchestrator integration."""
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON body required'}), 400
            
        text = data.get('text', '').strip()
        if not text:
            return jsonify({'error': 'text field is required'}), 400
            
        atlas_context = data.get('atlas', '')
        
        # Import here to avoid circular dependencies
        try:
            from intent_router import classify_intent, generate_casual_reply
            
            intent = classify_intent(text)
            reply = ''
            
            # Generate casual reply for chat intents
            if intent == 'chat':
                reply = generate_casual_reply(text)
                
            return jsonify({
                'success': True,
                'intent': intent,
                'reply': reply,
                'source': 'intent_router'
            })
            
        except ImportError as e:
            logger.warning(f"intent_router.py not available: {e}")
            # Fallback to simple heuristic
            intent = 'task' if any(word in text.lower() for word in ['зроби', 'створи', 'напиши', 'виконай', 'знайди']) else 'chat'
            return jsonify({
                'success': True,
                'intent': intent,
                'reply': '',
                'source': 'fallback'
            })
            
    except Exception as e:
        logger.error(f"/api/intent error: {e}")
        return jsonify({'error': 'Intent classification failed', 'details': str(e)}), 500

# ==================== VISION PROCESSING ENDPOINTS ====================

@app.route('/api/vision/status')
def vision_status():
    """Статус комп'ютерного зору"""
    return jsonify({
        'vision_available': VISION_AVAILABLE,
        'modules': {
            'opencv': 'cv2' in sys.modules,
            'mediapipe': 'mediapipe' in sys.modules,
            'yolo': 'ultralytics' in sys.modules,
            'pillow': 'PIL' in sys.modules
        }
    })

@app.route('/api/vision/upload', methods=['POST'])
def vision_upload():
    """Завантажує та обробляє зображення"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON body required'}), 400
        
        image_data = data.get('image')
        if not image_data:
            return jsonify({'error': 'image field is required'}), 400
        
        # Обробляємо зображення
        result = vision_processor.process_image_upload(image_data)
        
        if result['success']:
            logger.info(f"Image processed successfully: {result['timestamp']}")
            return jsonify({
                'success': True,
                'analysis': result['analysis'],
                'sequence': result['sequence'],
                'enhanced_available': True,
                'timestamp': result['timestamp']
            })
        else:
            return jsonify({'error': result['error']}), 500
            
    except Exception as e:
        logger.error(f"/api/vision/upload error: {e}")
        return jsonify({'error': 'Image processing failed', 'details': str(e)}), 500

@app.route('/api/vision/analyze', methods=['POST'])
def vision_analyze():
    """Детальний аналіз зображення з послідовністю дій"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON body required'}), 400
        
        image_data = data.get('image')
        generate_video = data.get('generate_video', False)
        
        if not image_data:
            return jsonify({'error': 'image field is required'}), 400
        
        # Обробляємо зображення
        result = vision_processor.process_image_upload(image_data)
        
        if not result['success']:
            return jsonify({'error': result['error']}), 500
        
        response = {
            'success': True,
            'analysis': result['analysis'],
            'sequence': result['sequence'],
            'enhanced_path': result['enhanced_path'],
            'scene_description': result['analysis']['scene_description']
        }
        
        # Генеруємо відео якщо потрібно
        if generate_video:
            try:
                video_path = vision_processor.generate_video_sequence(
                    result['enhanced_path'], 
                    result['sequence']
                )
                if video_path:
                    response['video_path'] = video_path
                    response['video_available'] = True
                else:
                    response['video_available'] = False
                    response['video_error'] = 'Video generation failed'
            except Exception as ve:
                logger.warning(f"Video generation failed: {ve}")
                response['video_available'] = False
                response['video_error'] = str(ve)
        
        return jsonify(response)
        
    except Exception as e:
        logger.error(f"/api/vision/analyze error: {e}")
        return jsonify({'error': 'Vision analysis failed', 'details': str(e)}), 500

@app.route('/api/vision/enhance', methods=['POST'])
def vision_enhance():
    """Покращує зображення"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        data = request.get_json()
        if not data:
            return jsonify({'error': 'JSON body required'}), 400
        
        image_data = data.get('image')
        if not image_data:
            return jsonify({'error': 'image field is required'}), 400
        
        # Тільки покращення зображення
        result = vision_processor.process_image_upload(image_data)
        
        if result['success']:
            # Читаємо покращене зображення та повертаємо як base64
            try:
                with open(result['enhanced_path'], 'rb') as f:
                    enhanced_data = base64.b64encode(f.read()).decode('utf-8')
                
                return jsonify({
                    'success': True,
                    'enhanced_image': f"data:image/jpeg;base64,{enhanced_data}",
                    'timestamp': result['timestamp']
                })
            except Exception as fe:
                logger.error(f"Failed to read enhanced image: {fe}")
                return jsonify({'error': 'Failed to read enhanced image'}), 500
        else:
            return jsonify({'error': result['error']}), 500
            
    except Exception as e:
        logger.error(f"/api/vision/enhance error: {e}")
        return jsonify({'error': 'Image enhancement failed', 'details': str(e)}), 500

@app.route('/api/vision/sequence/<timestamp>')
def vision_get_sequence(timestamp):
    """Отримує згенеровану послідовність за timestamp"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        # Шукаємо файли по timestamp
        temp_dir = vision_processor.temp_dir
        video_path = temp_dir / f"sequence_{timestamp}.mp4"
        
        if video_path.exists():
            return send_file(str(video_path), mimetype='video/mp4')
        else:
            return jsonify({'error': 'Video sequence not found'}), 404
            
    except Exception as e:
        logger.error(f"/api/vision/sequence error: {e}")
        return jsonify({'error': 'Failed to retrieve sequence'}), 500

@app.route('/api/vision/cleanup', methods=['POST'])
def vision_cleanup():
    """Очищає тимчасові файли"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        data = request.get_json() or {}
        hours = data.get('hours', 24)
        
        vision_processor.cleanup_temp_files(hours)
        
        return jsonify({
            'success': True,
            'message': f'Cleaned files older than {hours} hours'
        })
        
    except Exception as e:
        logger.error(f"/api/vision/cleanup error: {e}")
        return jsonify({'error': 'Cleanup failed', 'details': str(e)}), 500

# ==================== ATLAS CAMERA COMMUNICATION ENDPOINTS ====================

@app.route('/api/vision/camera/start', methods=['POST'])
def start_camera_communication():
    """Запускає камеру для спілкування Atlas з користувачем"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        result = vision_processor.start_camera_communication()
        
        if result["success"]:
            logger.info("Atlas camera communication started successfully")
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"/api/vision/camera/start error: {e}")
        return jsonify({'error': 'Failed to start camera', 'details': str(e)}), 500

@app.route('/api/vision/camera/stop', methods=['POST'])
def stop_camera_communication():
    """Зупиняє камеру"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        result = vision_processor.stop_camera_communication()
        logger.info("Atlas camera communication stopped")
        return jsonify(result)
        
    except Exception as e:
        logger.error(f"/api/vision/camera/stop error: {e}")
        return jsonify({'error': 'Failed to stop camera', 'details': str(e)}), 500

@app.route('/api/vision/camera/capture', methods=['POST'])
def capture_camera_frame():
    """Робить знімок поточного кадру для аналізу Atlas"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        result = vision_processor.capture_current_frame()
        
        if result["success"]:
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"/api/vision/camera/capture error: {e}")
        return jsonify({'error': 'Failed to capture frame', 'details': str(e)}), 500

@app.route('/api/vision/camera/status')
def camera_status():
    """Отримує статус камери та можливостей комп'ютерного зору"""
    if not VISION_AVAILABLE:
        return jsonify({'error': 'Computer vision not available'}), 503
    
    try:
        status = vision_processor.get_camera_status()
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"/api/vision/camera/status error: {e}")
        return jsonify({'error': 'Failed to get camera status', 'details': str(e)}), 500

# ==================== GRISHA VISUAL MONITORING ENDPOINTS ====================

@app.route('/api/grisha/start-monitoring', methods=['POST'])
def grisha_start_monitoring():
    """Запускає візуальний моніторинг для виконання завдання"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        data = request.get_json() or {}
        session_id = data.get('session_id', f"session_{int(time.time())}")
        task_description = data.get('task_description', 'Виконання завдання')
        
        result = grisha_monitor.start_monitoring(session_id, task_description)
        
        if result.get('success'):
            logger.info(f"Grisha monitoring started for session {session_id}")
            return jsonify(result)
        else:
            return jsonify(result), 500
            
    except Exception as e:
        logger.error(f"/api/grisha/start-monitoring error: {e}")
        return jsonify({'error': 'Failed to start monitoring', 'details': str(e)}), 500

@app.route('/api/grisha/stop-monitoring', methods=['POST'])
def grisha_stop_monitoring():
    """Зупиняє візуальний моніторинг та повертає звіт"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        result = grisha_monitor.stop_monitoring()
        
        if result.get('success'):
            logger.info(f"Grisha monitoring stopped for session {result.get('session_id')}")
            return jsonify(result)
        else:
            return jsonify(result), 500
            
    except Exception as e:
        logger.error(f"/api/grisha/stop-monitoring error: {e}")
        return jsonify({'error': 'Failed to stop monitoring', 'details': str(e)}), 500

@app.route('/api/grisha/visual-evidence')
def grisha_visual_evidence():
    """Отримує візуальні докази для верифікації"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        evidence = grisha_monitor.get_visual_evidence()
        
        return jsonify({
            'success': True,
            'evidence_count': len(evidence),
            'visual_evidence': evidence
        })
        
    except Exception as e:
        logger.error(f"/api/grisha/visual-evidence error: {e}")
        return jsonify({'error': 'Failed to get visual evidence', 'details': str(e)}), 500

@app.route('/api/grisha/monitoring-status')
def grisha_monitoring_status():
    """Перевіряє статус візуального моніторингу"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        return jsonify({
            'monitoring_active': grisha_monitor.monitoring_active,
            'session_id': grisha_monitor.session_id,
            'screenshots_count': len(grisha_monitor.screenshots_log) if grisha_monitor.screenshots_log else 0,
            'task_description': grisha_monitor.task_description
        })
        
    except Exception as e:
        logger.error(f"/api/grisha/monitoring-status error: {e}")
        return jsonify({'error': 'Failed to get monitoring status', 'details': str(e)}), 500

# ==================== ENHANCED GRISHA MONITORING ENDPOINTS ====================

@app.route('/api/grisha/screens/status')
def grisha_screens_status():
    """Отримує статус всіх доступних екранів для моніторингу Гришею"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        status = grisha_monitor.get_screen_status()
        return jsonify(status)
        
    except Exception as e:
        logger.error(f"/api/grisha/screens/status error: {e}")
        return jsonify({'error': 'Failed to get screen status', 'details': str(e)}), 500

@app.route('/api/grisha/screens/capture', methods=['POST'])
def grisha_capture_all_screens():
    """Робить знімки всіх доступних екранів для аналізу Гришею"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        result = grisha_monitor.capture_all_screens()
        
        if result["success"]:
            logger.info(f"Grisha captured {result['total_screens']} screens")
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"/api/grisha/screens/capture error: {e}")
        return jsonify({'error': 'Failed to capture screens', 'details': str(e)}), 500

@app.route('/api/grisha/reports/add', methods=['POST'])
def grisha_add_tetyana_report():
    """Додає звіт від Тетяни для перевірки Гришею"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        data = request.get_json() or {}
        if not data:
            return jsonify({'error': 'No report data provided'}), 400
        
        grisha_monitor.add_tetyana_report(data)
        
        return jsonify({
            'success': True,
            'message': 'Report added for Grisha verification',
            'report_count': len(grisha_monitor.tetyana_reports)
        })
        
    except Exception as e:
        logger.error(f"/api/grisha/reports/add error: {e}")
        return jsonify({'error': 'Failed to add report', 'details': str(e)}), 500

@app.route('/api/grisha/reports/verify', methods=['POST'])
def grisha_verify_report():
    """Грише перевіряє звіт Тетяни з візуальною валідацією"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        data = request.get_json() or {}
        report_index = data.get('report_index')
        verification = data.get('verification', {})
        
        if report_index is None:
            return jsonify({'error': 'Report index required'}), 400
        
        result = grisha_monitor.verify_tetyana_report(report_index, verification)
        
        if result["success"]:
            logger.info(f"Grisha verified report {report_index}")
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"/api/grisha/reports/verify error: {e}")
        return jsonify({'error': 'Failed to verify report', 'details': str(e)}), 500

@app.route('/api/grisha/reports/list')
def grisha_list_reports():
    """Отримує список всіх звітів Тетяни та верифікацій Гриші"""
    if not VISION_AVAILABLE or not grisha_monitor:
        return jsonify({'error': 'Grisha visual monitoring not available'}), 503
    
    try:
        return jsonify({
            'tetyana_reports': grisha_monitor.tetyana_reports,
            'grisha_verifications': grisha_monitor.grisha_verifications,
            'total_reports': len(grisha_monitor.tetyana_reports),
            'verified_reports': len(grisha_monitor.grisha_verifications)
        })
        
    except Exception as e:
        logger.error(f"/api/grisha/reports/list error: {e}")
        return jsonify({'error': 'Failed to list reports', 'details': str(e)}), 500

# ==================== WHISPER SPEECH RECOGNITION ENDPOINTS ====================

@app.route('/api/whisper/status')
def whisper_status():
    """Перевірка доступності Whisper Large 3"""
    try:
        # Тут буде логіка перевірки Whisper
        # Поки що повертаємо статичну відповідь
        return jsonify({
            'available': True,
            'model': 'whisper-large-3',
            'status': 'ready',
            'beam_sizes': [1, 3, 5, 10],
            'supported_languages': ['uk', 'en', 'ru'],
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error(f"/api/whisper/status error: {e}")
        return jsonify({
            'available': False,
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500

if __name__ == '__main__':
    # Print startup summary
    import platform
    print("\n" + "="*60)
    print("ATLAS FRONTEND SERVER - STARTUP SUMMARY")
    print("="*60)
    print(f"Python Version: {sys.version.split()[0]}")
    print(f"Platform: {platform.system()} {platform.release()}")
    print(f"Flask Version: {Flask.__version__}" if hasattr(Flask, '__version__') else "Flask: Unknown")
    print(f"Vision Available: {VISION_AVAILABLE}")
    print(f"Frontend Port: {FRONTEND_PORT}")
    print(f"Orchestrator URL: {ORCHESTRATOR_URL}")
    print(f"TTS Server URL: {TTS_SERVER_URL}")
    debug_mode = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1', 'yes')
    print(f"Debug Mode: {debug_mode}")
    print(f"Log Rotation: Enabled (10MB, 5 backups)")
    print("="*60)
    print("Starting server...\n")
    
    logger.info(f"Starting ATLAS Frontend Server on port {FRONTEND_PORT}")
    logger.info(f"Orchestrator URL: {ORCHESTRATOR_URL}")
    logger.info(f"TTS Server URL: {TTS_SERVER_URL}")
    
    # Use debug mode based on environment variable for production safety
    debug_mode = os.environ.get('FLASK_DEBUG', 'False').lower() in ('true', '1', 'yes')
    app.run(host='0.0.0.0', port=FRONTEND_PORT, debug=debug_mode)