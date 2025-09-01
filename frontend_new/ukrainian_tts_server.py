#!/usr/bin/env python3
"""
Simple Ukrainian TTS Server Mock for ATLAS Voice System Testing
Простий мок-сервер українського TTS для тестування голосової системи ATLAS
"""

import os
import io
import logging
import wave
import struct
import math
from flask import Flask, request, jsonify, Response
from flask_cors import CORS

# Налаштування логування
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

def generate_tone_wav(frequency=440, duration=2.0, sample_rate=44100, amplitude=0.5):
    """
    Генерує простий тоновий WAV-файл для тестування
    """
    frames = int(duration * sample_rate)
    audio_data = []
    
    for i in range(frames):
        # Генеруємо синусоїду
        value = amplitude * math.sin(frequency * 2 * math.pi * i / sample_rate)
        # Конвертуємо в 16-bit signed integer
        sample = int(value * 32767)
        audio_data.append(struct.pack('<h', sample))
    
    # Створюємо WAV в пам'яті
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, 'wb') as wav_file:
        wav_file.setnchannels(1)  # Mono
        wav_file.setsampwidth(2)  # 16-bit
        wav_file.setframerate(sample_rate)
        wav_file.writeframes(b''.join(audio_data))
    
    wav_buffer.seek(0)
    return wav_buffer.getvalue()

@app.route('/tts', methods=['POST'])
def synthesize_tts():
    """
    TTS ендпойнт для синтезу українського мовлення
    """
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Немає даних"}), 400
        
        text = data.get('text', '').strip()
        if not text:
            return jsonify({"error": "Пустий текст"}), 400
        
        voice = data.get('voice', 'dmytro')
        speed = float(data.get('speed', 1.0))
        pitch = float(data.get('pitch', 1.0))
        emotion = data.get('emotion', 'neutral')
        
        logger.info(f"TTS request: text='{text[:50]}...', voice={voice}, speed={speed}, pitch={pitch}, emotion={emotion}")
        
        # Генеруємо різні тони для різних голосів
        voice_frequencies = {
            'dmytro': 220,    # Atlas - низький голос
            'oleksa': 330,    # Тетяна - середній голос
            'robot': 180      # Гріша - низький роботизований
        }
        
        base_freq = voice_frequencies.get(voice, 260)
        # Коригуємо частоту на основі pitch
        frequency = base_freq * pitch
        
        # Коригуємо тривалість на основі швидкості та довжини тексту
        base_duration = len(text) * 0.1  # 0.1 секунди на символ
        duration = base_duration / speed
        duration = max(0.5, min(duration, 10.0))  # Обмежуємо від 0.5 до 10 секунд
        
        # Генеруємо тестовий звук
        wav_data = generate_tone_wav(
            frequency=frequency,
            duration=duration,
            amplitude=0.3
        )
        
        return Response(
            wav_data,
            mimetype='audio/wav',
            headers={
                'Content-Type': 'audio/wav',
                'Content-Length': str(len(wav_data)),
                'X-TTS-Voice': voice,
                'X-TTS-Text-Length': str(len(text)),
                'X-TTS-Duration': str(duration),
                'X-TTS-Frequency': str(frequency)
            }
        )
        
    except Exception as e:
        logger.error(f"TTS error: {e}")
        return jsonify({
            "error": f"Помилка синтезу: {str(e)}"
        }), 500

@app.route('/tts/voices', methods=['GET'])
def get_voices():
    """
    Список доступних голосів
    """
    return jsonify({
        "voices": [
            {
                "name": "dmytro",
                "description": "Дмитро - чоловічий голос (Atlas)",
                "gender": "male",
                "language": "uk",
                "frequency": 220
            },
            {
                "name": "oleksa",
                "description": "Олекса - жіночий голос (Тетяна)",
                "gender": "female", 
                "language": "uk",
                "frequency": 330
            },
            {
                "name": "robot",
                "description": "Робот - синтетичний голос (Гріша)",
                "gender": "neutral",
                "language": "uk",
                "frequency": 180
            }
        ]
    })

@app.route('/tts/health', methods=['GET'])
def health_check():
    """
    Перевірка здоров'я TTS сервера
    """
    return jsonify({
        "status": "ok",
        "service": "Ukrainian TTS Mock Server",
        "version": "1.0.0",
        "voices_available": 3,
        "supported_formats": ["wav"],
        "features": [
            "multi_voice_synthesis",
            "pitch_control",
            "speed_control",
            "emotion_support"
        ]
    })

@app.route('/', methods=['GET'])
def index():
    """
    Головна сторінка з інформацією про сервер
    """
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Ukrainian TTS Mock Server</title>
        <style>
            body { font-family: monospace; background: #000; color: #0f0; padding: 20px; }
            h1 { color: #0ff; }
            .endpoint { background: #111; padding: 10px; margin: 10px 0; border: 1px solid #333; }
            .method { color: #ff0; font-weight: bold; }
        </style>
    </head>
    <body>
        <h1>🎤 Ukrainian TTS Mock Server</h1>
        <p>Тестовий сервер для системи голосів ATLAS</p>
        
        <div class="endpoint">
            <div><span class="method">POST</span> /tts</div>
            <div>Синтез мовлення. Body: {"text": "текст", "voice": "dmytro|oleksa|robot"}</div>
        </div>
        
        <div class="endpoint">
            <div><span class="method">GET</span> /tts/voices</div>
            <div>Список доступних голосів</div>
        </div>
        
        <div class="endpoint">
            <div><span class="method">GET</span> /tts/health</div>
            <div>Статус сервера</div>
        </div>
        
        <p>Сервер працює на порті 3000</p>
    </body>
    </html>
    """

if __name__ == '__main__':
    port = int(os.environ.get('TTS_PORT', 3000))
    logger.info(f"Starting Ukrainian TTS Mock Server on port {port}")
    app.run(
        host='0.0.0.0',
        port=port,
        debug=False,
        threaded=True
    )