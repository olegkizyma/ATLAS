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

# Configuration
FRONTEND_PORT = int(os.environ.get('FRONTEND_PORT', 5001))
ORCHESTRATOR_URL = os.environ.get('ORCHESTRATOR_URL', 'http://localhost:5101')
TTS_SERVER_URL = os.environ.get('TTS_SERVER_URL', 'http://localhost:3000')

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
        'voice': 'robot',
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

@app.route('/api/agents')
def get_agents():
    """Get agent configuration"""
    return jsonify(AGENT_VOICES)

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
        
        if not text.strip():
            return jsonify({'error': 'Text is required'}), 400
            
        if agent not in AGENT_VOICES:
            return jsonify({'error': f'Unknown agent: {agent}'}), 400
            
        voice_name = AGENT_VOICES[agent]['voice']
        
        # Try Ukrainian TTS server first
        if requests:
            try:
                tts_response = requests.post(f'{TTS_SERVER_URL}/synthesize',
                                           json={
                                               'text': text,
                                               'voice': voice_name,
                                               'agent': agent
                                           },
                                           timeout=10)
                
                if tts_response.status_code == 200:
                    # Save audio file temporarily and return it
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
                        temp_file.write(tts_response.content)
                        temp_path = temp_file.name
                    
                    return send_file(temp_path, 
                                   mimetype='audio/wav',
                                   as_attachment=False,
                                   download_name=f'{agent}_{int(datetime.now().timestamp())}.wav')
                
            except Exception:
                logger.warning("TTS server unavailable, falling back to mock")
        
        # Fallback: return success for Web Speech API to handle
        return jsonify({
            'success': True,
            'fallback': True,
            'message': 'Using browser TTS',
            'text': text,
            'agent': agent,
            'voice': voice_name
        })
        
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