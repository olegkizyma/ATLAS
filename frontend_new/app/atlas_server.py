#!/usr/bin/env python3
"""
ATLAS Frontend Server with TTS Integration
Flask server that serves the web interface and provides TTS API
"""

import os
import sys
import logging
import json
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
from goose_client import GooseClient
from intent_router import classify_intent, generate_casual_reply
from stt_manager import stt_manager
from typing import Optional
import io
import wave
from threading import Lock
from time import monotonic
import re

try:
    # Optional: robust retry adapter if available
    from requests.adapters import HTTPAdapter  # type: ignore
    from urllib3.util.retry import Retry  # type: ignore
except Exception:
    HTTPAdapter = None
    Retry = None

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s'
)
logger = logging.getLogger('atlas.frontend')

# Get paths
CURRENT_DIR = Path(__file__).parent
TEMPLATE_DIR = CURRENT_DIR / 'templates'
STATIC_DIR = CURRENT_DIR / 'static'
TTS_DIR = CURRENT_DIR.parent.parent / 'ukrainian-tts'

app = Flask(__name__, 
           template_folder=str(TEMPLATE_DIR),
           static_folder=str(STATIC_DIR))
if CORS:
    CORS(app)

# Initialize Goose client
goose_client = GooseClient(base_url="http://localhost:3000", secret_key="test")

# Configuration
FRONTEND_PORT = int(os.environ.get('FRONTEND_PORT', 5001))
ORCHESTRATOR_URL = os.environ.get('ORCHESTRATOR_URL', 'http://localhost:5101')
# Default TTS points to Ukrainian TTS server on port 3001 (can be overridden via env)
TTS_SERVER_URL = os.environ.get('TTS_SERVER_URL', 'http://127.0.0.1:3001')
# Optional: comma-separated list of TTS endpoints for round-robin failover, e.g. "http://127.0.0.1:3001,http://127.0.0.1:3002"
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
        r = (http or requests).get(f"{base}{path}", timeout=timeout)
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
        r = (http or requests).post(f"{base}{path}", json=json_payload, timeout=timeout)
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
    return render_template('index.html', 
                         current_time=datetime.now().strftime('%H:%M:%S'))

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
    """Main chat endpoint with intent routing: casual chat vs task execution"""
    try:
        data = request.get_json()
        message = data.get('message', '')
        session_id = data.get('sessionId', 'default')
        user_id = data.get('userId', 'user')
        
        if not message.strip():
            return jsonify({'error': 'Message cannot be empty'}), 400

        # 1) Classify user's intent with prompt-only router (no keywords)
        try:
            intent = classify_intent(message)
        except Exception:
            intent = 'chat'

        if intent == 'chat':
            # 2) Stay at Atlas level: generate a short, friendly reply and do not invoke tools/agents
            try:
                reply = generate_casual_reply(message)
            except Exception:
                reply = f"Отримав повідомлення: {message}"
            return jsonify({
                'success': True,
                'response': [{
                    'role': 'assistant',
                    'content': f'[ATLAS] {reply}',
                    'agent': 'atlas',
                    'voice': AGENT_VOICES.get('atlas', {}).get('voice', 'dmytro')
                }]
            })

        # 3) intent == 'task': forward to orchestrator (existing behavior)
        if requests:
            response = requests.post(
                f'{ORCHESTRATOR_URL}/chat/stream',
                json={'message': message, 'sessionId': session_id, 'userId': user_id},
                timeout=30
            )
            if response.status_code == 200:
                return jsonify(response.json())
            else:
                return jsonify({'error': 'Orchestrator error'}), response.status_code
        else:
            return jsonify({
                'success': True,
                'response': [{
                    'role': 'assistant',
                    'content': f'[ATLAS] Отримав повідомлення: {message}',
                    'agent': 'atlas',
                    'voice': 'dmytro'
                }]
            })
            
    except Exception as e:
        if requests and hasattr(e, '__class__') and 'RequestException' in str(e.__class__):
            logger.error(f"Orchestrator connection failed: {e}")
            return jsonify({'error': 'Service unavailable'}), 503
        else:
            logger.error(f"Chat processing error: {e}")
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

@app.route('/api/status')
def status():
    """Simple status endpoint for Status Manager"""
    return jsonify({
        'timestamp': datetime.now().isoformat(),
        'processes': {
            'frontend': {'count': 1, 'status': 'running'},
            'orchestrator': {'count': 1 if check_orchestrator_health() == 'running' else 0, 'status': check_orchestrator_health()},
            'recovery': {'count': 1, 'status': 'running'},  # Recovery bridge is usually running if frontend is up
            'tts': {'count': 1 if check_tts_health() == 'running' else 0, 'status': check_tts_health()}
        },
        'memory': {'usage': 50},  # Placeholder
        'network': {'active': True}
    })

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
            language = request.form.get('language')  # None для автовизначення
            beam_size = int(request.form.get('beam_size', 5))
            temperature = float(request.form.get('temperature', 0.0))
            
            # Виконуємо транскрибацію
            result = stt_manager.transcribe_file(
                temp_file.name,
                language=language,
                beam_size=beam_size,
                temperature=temperature
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
            'web_speech_available': True  # Завжди доступний у браузері
        })
    except Exception as e:
        logger.error(f"/api/stt/models error: {e}")
        return jsonify({'error': 'Failed to get models info'}), 500

if __name__ == '__main__':
    logger.info(f"Starting ATLAS Frontend Server on port {FRONTEND_PORT}")
    logger.info(f"Orchestrator URL: {ORCHESTRATOR_URL}")
    logger.info(f"TTS Server URL: {TTS_SERVER_URL}")
    
    app.run(host='0.0.0.0', port=FRONTEND_PORT, debug=True)