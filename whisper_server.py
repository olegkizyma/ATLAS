#!/usr/bin/env python3
"""
Local Whisper STT Server
Faster-Whisper based HTTP API for speech-to-text transcription.

Usage:
    python whisper_server.py [options]

Environment variables:
    WHISPER_MODEL: Model size (tiny/base/small/medium/large-v1/large-v2/large-v3), default: large-v3
    WHISPER_DEVICE: Device (cpu/cuda/auto/mps), default: cpu (mps maps to auto for Metal)
    WHISPER_COMPUTE_TYPE: Precision/quantization (int8, int8_float16, float16, int16, int8_bfloat16, etc.)
    WHISPER_HOST: Host to bind, default: 127.0.0.1
    WHISPER_PORT: Port to bind, default: 5000
    WHISPER_TEMP_DIR: Temporary directory for uploaded files, default: /tmp
"""

from flask import Flask, request, jsonify
from werkzeug.utils import secure_filename
import os
import tempfile
import shutil
import logging
from pathlib import Path

try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False
    print("⚠️  faster-whisper не встановлено. Встановіть: pip install faster-whisper")

# Конфігурація
MODEL_SIZE = os.getenv("WHISPER_MODEL", "large-v3")
_RAW_DEVICE = os.getenv("WHISPER_DEVICE", "cpu").lower()
if _RAW_DEVICE == 'mps':
    print("WHISPER_DEVICE=mps detected. Using device=auto for CTranslate2 (Metal support).")
    DEVICE = 'auto'
else:
    DEVICE = _RAW_DEVICE
COMPUTE_TYPE = (os.getenv("WHISPER_COMPUTE_TYPE") or ("float16" if DEVICE == 'cuda' else "int8")).lower()
HOST = os.getenv("WHISPER_HOST", "127.0.0.1")
PORT = int(os.getenv("WHISPER_PORT", "5000"))
TEMP_DIR = os.getenv("WHISPER_TEMP_DIR", tempfile.gettempdir())

# Підтримувані формати аудіо
ALLOWED_EXTENSIONS = {
    'wav', 'mp3', 'mp4', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'opus'
}

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max file size

# Логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Глобальна змінна для моделі
whisper_model = None

def allowed_file(filename):
    """Перевіряє, чи підтримується формат файлу."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def init_whisper_model():
    """Ініціалізує модель Whisper."""
    global whisper_model
    if not FASTER_WHISPER_AVAILABLE:
        return False
    
    try:
        logger.info(f"Завантажую модель Whisper: {MODEL_SIZE} на пристрої: {DEVICE} (compute_type={COMPUTE_TYPE})")
        whisper_model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
        logger.info("✅ Модель Whisper успішно завантажена")
        return True
    except Exception as e:
        logger.error(f"❌ Помилка завантаження моделі Whisper: {e}")
        return False

@app.route('/health', methods=['GET'])
def health():
    """Перевірка стану сервера."""
    return jsonify({
        'status': 'ok',
        'whisper_available': whisper_model is not None,
        'model': MODEL_SIZE,
    'device': DEVICE,
    'compute_type': COMPUTE_TYPE,
        'version': '1.0.0'
    })

@app.route('/transcribe', methods=['POST'])
def transcribe():
    """Основний ендпоінт для транскрибації аудіо."""
    if not whisper_model:
        return jsonify({
            'error': 'Whisper model not available'
        }), 503

    # Перевіряємо наявність файлу
    if 'file' not in request.files:
        return jsonify({
            'error': 'No file uploaded'
        }), 400

    file = request.files['file']
    
    # Перевіряємо, чи файл не порожній
    if file.filename == '':
        return jsonify({
            'error': 'No file selected'
        }), 400

    # Перевіряємо розширення файлу
    if not allowed_file(file.filename):
        return jsonify({
            'error': f'Unsupported file format. Allowed: {", ".join(ALLOWED_EXTENSIONS)}'
        }), 400

    try:
        # Створюємо тимчасовий файл
        temp_file = tempfile.NamedTemporaryFile(
            dir=TEMP_DIR,
            suffix=f".{secure_filename(file.filename).rsplit('.', 1)[1].lower()}",
            delete=False
        )
        
        try:
            # Зберігаємо завантажений файл
            file.save(temp_file.name)
            logger.info(f"Файл збережено: {temp_file.name}")
            
            # Параметри транскрибації
            language = request.form.get('language') or 'uk'  # дефолт: українська
            beam_size = int(request.form.get('beam_size', 5))
            temperature = float(request.form.get('temperature', 0.0))
            
            # Виконуємо транскрибацію
            logger.info(f"Розпочинаю транскрибацію: {file.filename}")
            segments, info = whisper_model.transcribe(
                temp_file.name,
                beam_size=beam_size,
                temperature=temperature,
                language=language
            )
            
            # Збираємо текст з усіх сегментів
            text_segments = []
            full_text = ""
            
            for segment in segments:
                text_segments.append({
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text
                })
                full_text += segment.text
            
            # Очищаємо текст
            full_text = full_text.strip()
            
            logger.info(f"✅ Транскрибація завершена: {len(text_segments)} сегментів, {len(full_text)} символів")
            
            return jsonify({
                'text': full_text,
                'language': info.language,
                'language_probability': info.language_probability,
                'duration': info.duration,
                'segments': text_segments
            })
            
        finally:
            # Видаляємо тимчасовий файл
            try:
                os.unlink(temp_file.name)
            except OSError:
                pass
                
    except Exception as e:
        logger.error(f"❌ Помилка транскрибації: {e}")
        return jsonify({
            'error': f'Transcription failed: {str(e)}'
        }), 500

@app.route('/models', methods=['GET'])
def models():
    """Повертає інформацію про доступні моделі."""
    available_models = [
        'tiny', 'tiny.en',
        'base', 'base.en', 
        'small', 'small.en',
        'medium', 'medium.en',
        'large-v1', 'large-v2', 'large-v3'
    ]
    
    return jsonify({
        'current_model': MODEL_SIZE,
        'available_models': available_models,
    'device': DEVICE,
    'compute_type': COMPUTE_TYPE
    })

@app.errorhandler(413)
def too_large(e):
    """Обробка помилки завеликого файлу."""
    return jsonify({
        'error': 'File too large. Maximum size: 50MB'
    }), 413

if __name__ == '__main__':
    print(f"🚀 Запуск Whisper STT Server")
    print(f"📍 Host: {HOST}")
    print(f"🔌 Port: {PORT}")
    print(f"🧠 Model: {MODEL_SIZE}")
    print(f"💻 Device: {DEVICE}")
    print(f"🧮 Compute type: {COMPUTE_TYPE}")
    print(f"📁 Temp dir: {TEMP_DIR}")
    
    # Ініціалізуємо модель
    if init_whisper_model():
        print("✅ Whisper готовий до роботи!")
        app.run(host=HOST, port=PORT, debug=False)
    else:
        print("❌ Не вдалося ініціалізувати Whisper")
        exit(1)
