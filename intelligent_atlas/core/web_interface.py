#!/usr/bin/env python3
"""
ATLAS Web Interface
Мінімальний веб-інтерфейс для інтелігентної системи ATLAS
"""

import asyncio
import json
import logging
import time
import tempfile
import os
from typing import Dict, Any, Optional
from pathlib import Path
from flask import Flask, render_template, jsonify, request, send_file, make_response
from dataclasses import asdict
import threading

# Імпортуємо компоненти системи
from intelligent_engine import intelligent_engine, IntelligentRequest

logger = logging.getLogger('atlas.web_interface')

class WebInterface:
    """Мінімальний веб-інтерфейс для ATLAS"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.port = config.get('port', 5001)
        self.host = config.get('host', '127.0.0.1')
        self.debug = config.get('debug', False)
        
        # Шляхи до статики та шаблонів
        self.base_dir = Path(__file__).parent.parent
        self.static_dir = self.base_dir / 'static'
        self.templates_dir = self.base_dir / 'templates'
        
        # Flask додаток
        self.app = Flask(
            __name__,
            static_folder=str(self.static_dir),
            template_folder=str(self.templates_dir)
        )
        
        # Налаштовуємо CORS
        self._setup_cors()
        
        # Реєструємо маршрути
        self._register_routes()
        
        # Статистика
        self.stats = {
            'requests_total': 0,
            'requests_successful': 0,
            'requests_failed': 0,
            'chat_sessions': 0,
            'tts_requests': 0,
            'stt_requests': 0,
            'uptime_start': time.time()
        }
    
    def _setup_cors(self):
        """Налаштовує CORS"""
        @self.app.after_request
        def after_request(response):
            response.headers.add('Access-Control-Allow-Origin', '*')
            response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
            response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
            return response
    
    def _register_routes(self):
        """Реєструє всі маршрути"""
        
        @self.app.route('/')
        def index():
            """Головна сторінка"""
            return render_template('index.html')
        
        @self.app.route('/api/health')
        def health():
            """Health check"""
            return jsonify({
                'status': 'ok',
                'timestamp': time.time(),
                'uptime_seconds': time.time() - self.stats['uptime_start'],
                'engine_initialized': intelligent_engine.is_initialized
            })
        
        @self.app.route('/api/chat', methods=['POST'])
        def chat():
            """Головний чат endpoint"""
            self.stats['requests_total'] += 1
            
            try:
                data = request.get_json()
                if not data or 'message' not in data:
                    return jsonify({'error': 'Message is required'}), 400
                
                user_message = data['message']
                session_id = data.get('sessionId', f'session_{int(time.time())}')
                
                if not user_message.strip():
                    return jsonify({'error': 'Message cannot be empty'}), 400
                
                # Створюємо інтелігентний запит
                intelligent_request = IntelligentRequest(
                    user_message=user_message,
                    session_id=session_id,
                    timestamp=time.time(),
                    context=data.get('context', {}),
                    metadata=data.get('metadata', {})
                )
                
                # Обробляємо через інтелігентний движок
                response = asyncio.run(
                    intelligent_engine.process_intelligent_request(intelligent_request)
                )
                
                self.stats['requests_successful'] += 1
                
                return jsonify({
                    'success': response.success,
                    'response': [{
                        'role': 'assistant',
                        'content': response.response_text,
                        'agent': response.agent_used,
                        'timestamp': time.time(),
                        'evidence': response.execution_evidence
                    }],
                    'session': {
                        'id': session_id,
                        'currentAgent': response.agent_used
                    },
                    'tts_ready': response.tts_ready,
                    'needs_continuation': response.needs_continuation
                })
                
            except Exception as e:
                self.stats['requests_failed'] += 1
                logger.error(f"Chat request failed: {e}")
                
                return jsonify({
                    'success': False,
                    'error': str(e),
                    'response': [{
                        'role': 'assistant',
                        'content': 'Вибачте, сталася помилка при обробці запиту. Спробуйте ще раз.',
                        'agent': 'system',
                        'timestamp': time.time()
                    }]
                }), 500
        
        @self.app.route('/api/voice/synthesize', methods=['POST'])
        def synthesize_voice():
            """TTS синтезація"""
            self.stats['tts_requests'] += 1
            
            try:
                data = request.get_json()
                text = data.get('text', '')
                agent = data.get('agent', 'atlas')
                
                if not text.strip():
                    return jsonify({'error': 'Text is required'}), 400
                
                # Підготовуємо текст для TTS
                voice_response = asyncio.run(
                    intelligent_engine.voice_system.prepare_voice_response(text)
                )
                
                if not voice_response['success']:
                    return jsonify({'error': 'Failed to prepare voice response'}), 500
                
                # Синтезуємо через voice system
                from voice_system import VoiceRequest
                voice_request = VoiceRequest(
                    text=voice_response['text'],
                    agent=voice_response['agent'],
                    voice=voice_response['voice']
                )
                
                audio_data = asyncio.run(
                    intelligent_engine.voice_system.synthesize_speech(voice_request)
                )
                
                if audio_data:
                    # Створюємо тимчасовий файл для аудіо
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
                        temp_file.write(audio_data)
                        temp_path = temp_file.name
                    
                    response = make_response(
                        send_file(temp_path, mimetype='audio/wav', as_attachment=False)
                    )
                    response.headers['Cache-Control'] = 'no-store'
                    
                    # Очищаємо тимчасовий файл через деякий час
                    threading.Timer(60.0, lambda: self._cleanup_temp_file(temp_path)).start()
                    
                    return response
                else:
                    # Повертаємо мовчанку якщо TTS не вдався
                    return self._generate_silence_response()
                    
            except Exception as e:
                logger.error(f"TTS synthesis failed: {e}")
                return self._generate_silence_response()
        
        @self.app.route('/api/voice/transcribe', methods=['POST'])
        def transcribe_audio():
            """STT транскрибація"""
            self.stats['stt_requests'] += 1
            
            try:
                # Перевіряємо наявність файлу
                if 'file' not in request.files:
                    return jsonify({'success': False, 'error': 'No file uploaded'}), 400
                
                file = request.files['file']
                if file.filename == '':
                    return jsonify({'success': False, 'error': 'No file selected'}), 400
                
                # Зберігаємо тимчасово
                with tempfile.NamedTemporaryFile(delete=False, suffix='.wav') as temp_file:
                    file.save(temp_file.name)
                    temp_path = temp_file.name
                
                try:
                    # Розпізнаємо через voice system
                    from voice_system import STTRequest
                    stt_request = STTRequest(
                        audio_file=temp_path,
                        language=request.form.get('language', 'uk'),
                        model=request.form.get('model', 'large-v3')
                    )
                    
                    result = asyncio.run(
                        intelligent_engine.voice_system.transcribe_audio(stt_request)
                    )
                    
                    return jsonify(result or {'success': False, 'error': 'STT not available'})
                    
                finally:
                    # Очищаємо тимчасовий файл
                    self._cleanup_temp_file(temp_path)
                    
            except Exception as e:
                logger.error(f"STT transcription failed: {e}")
                return jsonify({
                    'success': False,
                    'error': f'Transcription failed: {str(e)}'
                }), 500
        
        @self.app.route('/api/system/status')
        def system_status():
            """Статус системи"""
            return jsonify(asyncio.run(intelligent_engine.get_system_status()))
        
        @self.app.route('/api/stats')
        def get_stats():
            """Статистика веб-інтерфейсу"""
            return jsonify({
                **self.stats,
                'uptime_seconds': time.time() - self.stats['uptime_start']
            })
        
        @self.app.route('/api/voice/agents')
        def voice_agents():
            """Інформація про голосових агентів"""
            return jsonify(asyncio.run(self._get_voice_agents_info()))
        
        @self.app.route('/api/voice/prepare_response', methods=['POST'])
        def prepare_voice_response():
            """Підготовка тексту для озвучування"""
            try:
                data = request.get_json()
                text = data.get('text', '')
                
                if not text:
                    return jsonify({'success': False, 'error': 'Text is required'}), 400
                
                result = asyncio.run(
                    intelligent_engine.voice_system.prepare_voice_response(text)
                )
                
                return jsonify(result)
                
            except Exception as e:
                logger.error(f"Voice preparation failed: {e}")
                return jsonify({'success': False, 'error': str(e)}), 500
    
    def _generate_silence_response(self):
        """Генерує мовчанку як fallback для TTS"""
        try:
            # Створюємо тимчасовий WAV файл з тишею
            import wave
            import io
            
            silence_buffer = io.BytesIO()
            with wave.open(silence_buffer, 'wb') as wav_file:
                wav_file.setnchannels(1)  # Моно
                wav_file.setsampwidth(2)  # 16-bit
                wav_file.setframerate(22050)  # 22kHz
                # 500ms тиші
                silence_frames = int(22050 * 0.5)
                wav_file.writeframes(b'\x00\x00' * silence_frames)
            
            silence_buffer.seek(0)
            
            response = make_response(silence_buffer.getvalue())
            response.headers['Content-Type'] = 'audio/wav'
            response.headers['Cache-Control'] = 'no-store'
            response.headers['X-TTS-Fallback'] = 'silence'
            
            return response
            
        except Exception as e:
            logger.error(f"Failed to generate silence: {e}")
            return jsonify({'error': 'TTS synthesis failed'}), 500
    
    def _cleanup_temp_file(self, file_path: str):
        """Очищає тимчасовий файл"""
        try:
            if os.path.exists(file_path):
                os.unlink(file_path)
        except Exception as e:
            logger.warning(f"Failed to cleanup temp file {file_path}: {e}")
    
    async def _get_voice_agents_info(self) -> Dict[str, Any]:
        """Повертає інформацію про голосових агентів"""
        try:
            if intelligent_engine.voice_system:
                voice_status = await intelligent_engine.voice_system.get_status()
                available_voices = await intelligent_engine.voice_system.get_available_voices()
                
                return {
                    'success': True,
                    'agents': voice_status.get('agent_voices', {}),
                    'availableVoices': available_voices,
                    'locale': 'uk-UA',
                    'tts_available': voice_status.get('tts_available', False),
                    'stt_available': voice_status.get('stt_available', False)
                }
            else:
                return {
                    'success': False,
                    'error': 'Voice system not initialized'
                }
                
        except Exception as e:
            logger.error(f"Failed to get voice agents info: {e}")
            return {
                'success': False,
                'error': str(e)
            }
    
    def run(self):
        """Запускає веб-сервер"""
        logger.info(f"🌐 Starting ATLAS Web Interface on {self.host}:{self.port}")
        
        try:
            self.app.run(
                host=self.host,
                port=self.port,
                debug=self.debug,
                threaded=True,
                use_reloader=False  # Вимикаємо reloader для стабільності
            )
        except Exception as e:
            logger.error(f"❌ Failed to start web interface: {e}")
            raise
    
    def shutdown(self):
        """Завершує роботу веб-інтерфейсу"""
        logger.info("🔄 Shutting down Web Interface...")
        # Flask має власний механізм shutdown
        logger.info("✅ Web Interface shutdown complete")