"""
STT (Speech-to-Text) module for ATLAS frontend
Integrates Faster-Whisper with fallback to Web Speech API
"""

import os
import tempfile
import logging
from pathlib import Path
from typing import Optional, Dict, Any

try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
except ImportError:
    FASTER_WHISPER_AVAILABLE = False

logger = logging.getLogger(__name__)

class STTManager:
    """Manages speech-to-text functionality with Whisper and Web Speech API fallback."""
    
    def __init__(self):
        self.whisper_model = None
        self.model_size = os.getenv('WHISPER_MODEL', 'base')
        self.device = os.getenv('WHISPER_DEVICE', 'cpu')
        self.temp_dir = os.getenv('WHISPER_TEMP_DIR', tempfile.gettempdir())
        
        # Підтримувані формати
        self.allowed_extensions = {
            'wav', 'mp3', 'mp4', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'opus'
        }
        
        self._init_whisper()
    
    def _init_whisper(self) -> bool:
        """Ініціалізує модель Whisper."""
        if not FASTER_WHISPER_AVAILABLE:
            logger.warning("faster-whisper не доступний. STT працюватиме тільки через Web Speech API.")
            return False
        
        try:
            logger.info(f"Завантажую Whisper модель: {self.model_size} на {self.device}")
            self.whisper_model = WhisperModel(
                self.model_size, 
                device=self.device,
                compute_type="int8"
            )
            logger.info("✅ Whisper модель успішно завантажена")
            return True
        except Exception as e:
            logger.error(f"❌ Помилка завантаження Whisper: {e}")
            return False
    
    def is_whisper_available(self) -> bool:
        """Перевіряє, чи доступна модель Whisper."""
        return self.whisper_model is not None
    
    def allowed_file(self, filename: str) -> bool:
        """Перевіряє, чи підтримується формат файлу."""
        return '.' in filename and \
               filename.rsplit('.', 1)[1].lower() in self.allowed_extensions
    
    def transcribe_file(self, 
                       file_path: str, 
                       language: Optional[str] = None,
                       beam_size: int = 5,
                       temperature: float = 0.0) -> Dict[str, Any]:
        """
        Транскрибує аудіофайл за допомогою Whisper.
        
        Args:
            file_path: Шлях до аудіофайлу
            language: Код мови (None для автовизначення)
            beam_size: Розмір beam для пошуку
            temperature: Температура для sampling
        
        Returns:
            Dict з результатом транскрибації
        """
        if not self.is_whisper_available():
            raise ValueError("Whisper модель недоступна")
        
        try:
            logger.info(f"Транскрибую файл: {file_path}")
            
            # Виконуємо транскрибацію
            segments, info = self.whisper_model.transcribe(
                file_path,
                beam_size=beam_size,
                temperature=temperature,
                language=language
            )
            
            # Збираємо результат
            text_segments = []
            full_text = ""
            
            for segment in segments:
                text_segments.append({
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text
                })
                full_text += segment.text
            
            full_text = full_text.strip()
            
            logger.info(f"✅ Транскрибація завершена: {len(text_segments)} сегментів")
            
            return {
                'success': True,
                'text': full_text,
                'language': info.language,
                'language_probability': info.language_probability,
                'duration': info.duration,
                'segments': text_segments,
                'source': 'whisper'
            }
            
        except Exception as e:
            logger.error(f"❌ Помилка транскрибації: {e}")
            return {
                'success': False,
                'error': str(e),
                'source': 'whisper'
            }
    
    def get_status(self) -> Dict[str, Any]:
        """Повертає статус STT системи."""
        return {
            'whisper_available': self.is_whisper_available(),
            'whisper_model': self.model_size if self.is_whisper_available() else None,
            'device': self.device,
            'supported_formats': list(self.allowed_extensions),
            'fallback_available': True,  # Web Speech API завжди доступний у браузері
        }

# Глобальний instance STT менеджера
stt_manager = STTManager()
