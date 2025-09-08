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

try:  # Torch optional import guard (fail gracefully if missing)
    import torch  # type: ignore
except Exception:  # pragma: no cover
    torch = None  # type: ignore

# Налаштування логування
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)

# Custom filter to reduce health check noise in logs
class HealthCheckFilter(logging.Filter):
    def filter(self, record):
        # Suppress frequent health check logs
        if hasattr(record, 'msg') and isinstance(record.msg, str):
            message = str(record.msg)
            # Skip health check related logs at INFO level
            if any(pattern in message for pattern in [
                'GET /health HTTP',
                'GET /voices HTTP',
                'GET /status HTTP'
            ]):
                return False
        return True

logger = logging.getLogger('ukrainian-tts-server')

# Apply health check filter to werkzeug logger to reduce noise
werkzeug_logger = logging.getLogger('werkzeug')
werkzeug_logger.addFilter(HealthCheckFilter())

def gpu_capabilities():
    """Return detected GPU / accelerator capabilities."""
    caps = {
        'torch_imported': torch is not None,
        'cuda_available': False,
        'mps_available': False,
        'cuda_device_count': 0,
    }
    if torch is None:
        return caps
    try:
        caps['cuda_available'] = bool(torch.cuda.is_available())
        if caps['cuda_available']:
            caps['cuda_device_count'] = torch.cuda.device_count()
    except Exception:
        pass
    try:
        caps['mps_available'] = bool(getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available())
    except Exception:
        pass
    return caps

def select_device(requested: str, strict_gpu: bool = False) -> str:
    """Resolve device selection (CUDA > MPS > CPU) with optional strict mode."""
    req = requested.lower()
    if req not in {"auto", "gpu"}:
        if req == "cuda" and (torch is None or not getattr(torch, 'cuda', None) or not torch.cuda.is_available()):
            if strict_gpu:
                raise RuntimeError("Requested CUDA but not available in strict GPU mode")
            return "cpu"
        if req == "mps":
            if torch is None:
                if strict_gpu:
                    raise RuntimeError("Torch not available for MPS in strict GPU mode")
                return "cpu"
            if not (getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available()):
                if strict_gpu:
                    raise RuntimeError("MPS backend not available in strict GPU mode")
                return "cpu"
        return req
    caps = gpu_capabilities()
    if caps['cuda_available']:
        return 'cuda'
    if caps['mps_available']:
        return 'mps'
    if strict_gpu:
        raise RuntimeError("No GPU (CUDA/MPS) available in strict GPU mode")
    return 'cpu'


class UkrainianTTSServer:
    def __init__(self, host='127.0.0.1', port=3001, device='cpu', warmup_text: str | None = None, strict_gpu: bool = False):
        self.host = host
        self.port = port
        self.device = device
        self.strict_gpu = strict_gpu
        
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
            init_device = self.device
            
            # Set default tensor types for MPS compatibility
            if init_device == "mps":
                try:
                    import torch
                    # Force float32 for MPS compatibility
                    torch.set_default_dtype(torch.float32)
                    logger.info("Set default dtype to float32 for MPS compatibility")
                except Exception as dtype_error:
                    logger.warning(f"Could not set default dtype: {dtype_error}")
            
            # Attempt initialization; handle MPS float64 issues gracefully.
            try:
                self.tts = TTS(device=init_device)
            except Exception as e:
                if init_device == "mps" and ("float64" in str(e).lower() or "dtype" in str(e).lower() or "mps" in str(e).lower()):
                    logger.warning(f"MPS precision issue detected: {e}")
                    try:
                        # Try to force float32 conversion and retry
                        import torch
                        torch.set_default_dtype(torch.float32)
                        logger.info("Forcing float32 for MPS and retrying...")
                        self.tts = TTS(device=init_device)
                        logger.info("✅ MPS initialization successful with float32")
                    except Exception as e2:
                        if self.strict_gpu:
                            raise RuntimeError(f"MPS init (precision) failed under strict GPU mode: {e2}")
                        logger.warning("MPS precision issue persists. Falling back to CPU.")
                        self.tts = TTS(device="cpu")
                        self.device = "cpu"
                elif init_device == "cuda":
                    # Try MPS then maybe CPU (unless strict)
                    logger.warning(f"CUDA init failed ({e}); trying MPS")
                    if torch is not None and getattr(torch.backends, 'mps', None) and torch.backends.mps.is_available():
                        try:
                            self.tts = TTS(device='mps')
                            self.device = 'mps'
                        except Exception as e2:
                            if self.strict_gpu:
                                raise RuntimeError(f"MPS fallback failed under strict GPU mode: {e2}")
                            logger.warning("MPS fallback also failed; using CPU")
                            self.tts = TTS(device='cpu')
                            self.device = 'cpu'
                    else:
                        if self.strict_gpu:
                            raise RuntimeError("No alternative GPU backend (MPS) present in strict GPU mode")
                        self.tts = TTS(device='cpu')
                        self.device = 'cpu'
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
            return jsonify({
                'status': 'ok' if self.tts else 'error',
                'tts_ready': self.tts is not None,
                'device': self.device,
                'timestamp': time.time()
            })

        @self.app.route('/voices', methods=['GET'])
        def get_voices():
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

        @self.app.route('/info', methods=['GET'])
        def info():
            caps = gpu_capabilities()
            caps['selected'] = self.device
            return jsonify({
                'status': 'ok' if self.tts else 'error',
                'device': self.device,
                'strict_gpu': self.strict_gpu,
                'gpu': caps,
                'torch_version': getattr(torch, '__version__', None) if torch else None,
                'voices': [v.value for v in Voices],
                'pid': os.getpid(),
                'cwd': str(Path.cwd()),
                'python': sys.version.split()[0],
                'env_flags': {
                    'TTS_STRICT_GPU': os.getenv('TTS_STRICT_GPU'),
                    'TTS_DEVICE': os.getenv('TTS_DEVICE'),
                },
                'timestamp': time.time()
            })

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
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "gpu", "cuda"], help="Device to use (auto detects cuda > mps > cpu)")
    parser.add_argument("--strict-gpu", action="store_true", help="Fail to start if neither CUDA nor MPS available")
    parser.add_argument("--debug", action="store_true", help="Enable debug mode")
    parser.add_argument("--no-warmup", action="store_true", help="Skip initial warmup synthesis")
    
    args = parser.parse_args()
    
    # Створюємо і запускаємо сервер
    try:
        resolved_device = select_device(args.device, strict_gpu=args.strict_gpu)
    except Exception as e:
        logger.error(f"Device selection failed: {e}")
        sys.exit(2)
    logger.info(f"Resolved device selection: requested={args.device} strict={args.strict_gpu} => using={resolved_device}")
    server = UkrainianTTSServer(
        host=args.host,
        port=args.port,
        device=resolved_device,
        strict_gpu=args.strict_gpu
    )

    # Optional warmup to reduce first-request latency
    if server.tts and not args.no_warmup:
        try:
            _t = "Привіт, система Ukrainian TTS готова до роботи."[:80]
            start_w = time.time()
            buf = io.BytesIO()
            server.tts.tts(_t, 'dmytro', Stress.Dictionary.value, buf)
            dt = time.time() - start_w
            logger.info(f"Warmup synthesis completed in {dt:.2f}s")
        except Exception as e:  # pragma: no cover
            logger.warning(f"Warmup failed: {e}")
    server.run(debug=args.debug)

if __name__ == '__main__':
    main()
