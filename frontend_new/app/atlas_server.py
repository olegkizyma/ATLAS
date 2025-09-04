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
from flask import Flask, render_template, jsonify, request, send_file
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
        
        # Read frontend logs
        logs = []
        log_files = [
            '../logs/frontend.log',
            '../logs/orchestrator.log', 
            '../logs/recovery_bridge.log'
        ]
        
        for log_file in log_files:
            log_path = CURRENT_DIR.parent / log_file.replace('../', '')
            if log_path.exists():
                try:
                    with open(log_path, 'r') as f:
                        lines = f.readlines()[-limit:]
                        for line in lines:
                            if line.strip():
                                logs.append({
                                    'timestamp': datetime.now().isoformat(),
                                    'source': log_path.name,
                                    'message': line.strip()
                                })
                except Exception as e:
                    logger.warning(f"Failed to read {log_file}: {e}")
        
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
    """Main chat endpoint that forwards to orchestrator"""
    try:
        data = request.get_json()
        message = data.get('message', '')
        session_id = data.get('sessionId', 'default')
        user_id = data.get('userId', 'user')
        
        if not message.strip():
            return jsonify({'error': 'Message cannot be empty'}), 400
            
        # Forward to orchestrator
        if requests:
            response = requests.post(f'{ORCHESTRATOR_URL}/chat/stream', 
                                   json={
                                       'message': message,
                                       'sessionId': session_id,
                                       'userId': user_id
                                   },
                                   timeout=30)
            
            if response.status_code == 200:
                return jsonify(response.json())
            else:
                return jsonify({'error': 'Orchestrator error'}), response.status_code
        else:
            # Fallback mock response if requests not available
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
        
        # Try Ukrainian TTS server first
        if requests:
            try:
                tts_payload = {
                    'text': text,
                    'voice': voice_name,
                    'fx': fx,
                    'speed': speed,
                    'agent': agent,
                    'return_audio': True
                }
                tts_response = requests.post(
                    f'{TTS_SERVER_URL}/tts',
                    json=tts_payload,
                    timeout=20
                )
                
                if tts_response.status_code == 200:
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
                        temp_file.write(tts_response.content)
                        temp_path = temp_file.name
                    return send_file(temp_path, mimetype='audio/wav', as_attachment=False,
                                     download_name=f'{agent}_{int(datetime.now().timestamp())}.wav')
                else:
                    logger.warning(f"TTS server HTTP {tts_response.status_code}: {tts_response.text[:200]}")
            except Exception as e:
                logger.warning(f"TTS server unavailable: {e}")
        
        # Не используем браузерный Web Speech: сигнализируем об ошибке TTS
        return jsonify({'error': 'TTS server unavailable or failed'}), 502
        
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
                r = requests.get(f"{TTS_SERVER_URL}/voices", timeout=5)
                if r.status_code == 200:
                    payload = r.json()
                    voices_list = payload.get('voices', [])
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
        response = requests.get(f'{TTS_SERVER_URL}/health', timeout=5)
        return 'running' if response.status_code == 200 else 'error'  
    except:
        return 'fallback'  # Can use browser TTS

if __name__ == '__main__':
    logger.info(f"Starting ATLAS Frontend Server on port {FRONTEND_PORT}")
    logger.info(f"Orchestrator URL: {ORCHESTRATOR_URL}")
    logger.info(f"TTS Server URL: {TTS_SERVER_URL}")
    
    app.run(host='0.0.0.0', port=FRONTEND_PORT, debug=True)