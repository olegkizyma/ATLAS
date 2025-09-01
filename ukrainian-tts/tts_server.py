#!/usr/bin/env python3
"""
Ukrainian TTS HTTP Server
Простий HTTP сервер для українського TTS
"""

import os
import sys
import time
import logging
import argparse
import io
import json
import tempfile
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from ukrainian_tts.tts import TTS, Voices, Stress
import soundfile as sf
import numpy as np
import librosa

# Налаштування логування
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger('ukrainian-tts-server')

class UkrainianTTSServer:
    def __init__(self, host='127.0.0.1', port=3001, device='cpu'):
        self.host = host
        self.port = port
        self.device = device
        
        # Створюємо Flask app
        self.app = Flask(__name__)
        self.app.config['SECRET_KEY'] = 'ukrainian-tts-server-key'
        
        # Ініціалізуємо TTS
        self.tts = None
        self._init_tts()
        
        # Реєструємо маршрути
        self._register_routes()
        
        logger.info(f"Ukrainian TTS Server initialized at {host}:{port}")
    
    def _init_tts(self):
        """Ініціалізуємо TTS систему"""
        try:
            logger.info(f"Initializing Ukrainian TTS on device: {self.device}")
            
            # Спробуємо з заданим девайсом, fallback до CPU якщо помилка
            try:
                self.tts = TTS(device=self.device)
            except Exception as e:
                if self.device == "mps" and "float64" in str(e).lower():
                    logger.warning("MPS doesn't support float64, falling back to CPU")
                    self.tts = TTS(device="cpu")
                    self.device = "cpu"
                else:
                    raise
            
            logger.info("Ukrainian TTS initialized successfully")
            
        except Exception as e:
            logger.error(f"Failed to initialize Ukrainian TTS: {e}")
            self.tts = None
    
    def _register_routes(self):
        """Реєструємо API маршрути"""
        
        @self.app.route('/health', methods=['GET'])
        def health():
            """Health check endpoint"""
            return jsonify({
                'status': 'ok' if self.tts else 'error',
                'tts_ready': self.tts is not None,
                'device': self.device,
                'timestamp': time.time()
            })
        
        @self.app.route('/voices', methods=['GET'])
        def get_voices():
            """Список доступних голосів"""
            try:
                voices = [v.value for v in Voices]
                return jsonify({
                    'voices': voices,
                    'default': 'dmytro',
                    'timestamp': time.time()
                })
            except Exception as e:
                logger.error(f"Error getting voices: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/tts', methods=['POST'])
        def synthesize_text():
            """Основний ендпойнт для синтезу мови"""
            try:
                if not self.tts:
                    return jsonify({'error': 'TTS not initialized'}), 503
                
                data = request.get_json()
                if not data:
                    return jsonify({'error': 'JSON body required'}), 400
                
                text = data.get('text', '').strip()
                if not text:
                    return jsonify({'error': 'Text is required'}), 400
                
                voice = data.get('voice', 'dmytro')
                fx = data.get('fx', 'none')  # Звукові ефекти
                speed = float(data.get('speed', 1.0))
                return_audio = data.get('return_audio', False)  # Повертати аудіо файл
                
                logger.info(f"TTS request: text='{text[:50]}...', voice={voice}, fx={fx}")
                
                # Синтезуємо в пам'яті
                buf = io.BytesIO()
                start_time = time.time()
                _, accented = self.tts.tts(text, voice, Stress.Dictionary.value, buf)
                synthesis_time = time.time() - start_time
                
                # Читаємо аудіо
                buf.seek(0)
                audio, sr = sf.read(buf, dtype="float32")
                
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)
                
                # Застосовуємо швидкість
                if speed and abs(speed - 1.0) > 1e-3:
                    try:
                        audio = librosa.effects.time_stretch(audio, rate=speed)
                    except Exception:
                        pass
                
                # Застосовуємо звукові ефекти (простий варіант)
                if fx == "robot":
                    try:
                        audio = librosa.effects.pitch_shift(audio, sr=sr, n_steps=-4)
                    except Exception:
                        pass
                
                # Нормалізуємо
                peak = float(np.max(np.abs(audio)) or 1.0)
                audio = (audio / peak) * 0.95
                
                if return_audio:
                    # Повертаємо аудіо файл
                    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.wav')
                    sf.write(temp_file.name, audio, sr, subtype="PCM_16")
                    
                    return send_file(
                        temp_file.name,
                        mimetype='audio/wav',
                        as_attachment=True,
                        download_name=f'tts_{int(time.time())}.wav'
                    )
                else:
                    # Повертаємо JSON відповідь
                    return jsonify({
                        'status': 'success',
                        'accented_text': accented,
                        'synthesis_time': round(synthesis_time, 3),
                        'audio_duration': round(len(audio) / sr, 3),
                        'sample_rate': int(sr),
                        'voice': voice,
                        'fx': fx,
                        'timestamp': time.time()
                    })
                
            except Exception as e:
                logger.error(f"TTS synthesis error: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/speak', methods=['POST'])
        def speak_text():
            """Альтернативний ендпойнт (сумісність)"""
            return synthesize_text()
        
        @self.app.errorhandler(404)
        def not_found(error):
            return jsonify({'error': 'Endpoint not found'}), 404
        
        @self.app.errorhandler(500)
        def internal_error(error):
            logger.error(f"Internal server error: {error}")
            return jsonify({'error': 'Internal server error'}), 500
    
    def run(self, debug=False):
        """Запускаємо сервер"""
        try:
            logger.info(f"Starting Ukrainian TTS Server on {self.host}:{self.port}")
            logger.info(f"TTS ready: {self.tts is not None}")
            logger.info(f"Device: {self.device}")
            
            self.app.run(
                host=self.host,
                port=self.port,
                debug=debug,
                threaded=True,
                use_reloader=False
            )
            
        except KeyboardInterrupt:
            logger.info("Server stopped by user")
        except Exception as e:
            logger.error(f"Server error: {e}")
            raise

def main():
    """Головна функція"""
    parser = argparse.ArgumentParser(description="Ukrainian TTS HTTP Server")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind to")
    parser.add_argument("--port", type=int, default=3001, help="Port to bind to")
    parser.add_argument("--device", default="cpu", choices=["cpu", "mps", "gpu"], help="Device to use")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    
    args = parser.parse_args()
    
    # Створюємо і запускаємо сервер
    server = UkrainianTTSServer(
        host=args.host,
        port=args.port,
        device=args.device
    )
    server.run(debug=args.debug)

if __name__ == '__main__':
    main()
