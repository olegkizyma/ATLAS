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
        self.model_size = os.getenv('WHISPER_MODEL', 'large-v3')
        # Normalize device (allow 'mps' from PyTorch users by mapping to auto)
        raw_device = os.getenv('WHISPER_DEVICE', 'cpu').lower()
        if raw_device == 'mps':
            # CTranslate2 does not recognize 'mps'; best effort is 'auto'
            logger.info("WHISPER_DEVICE=mps detected. Mapping to device=auto for CTranslate2 (Metal).")
            self.device = 'auto'
        else:
            self.device = raw_device
        # Compute type (quantization/precision)
        # Defaults: int8 for CPU/auto, float16 for CUDA if not explicitly set
        env_ct = (os.getenv('WHISPER_COMPUTE_TYPE') or '').strip().lower()
        if env_ct:
            self.compute_type = env_ct
        else:
            self.compute_type = 'float16' if self.device == 'cuda' else 'int8'
        self.temp_dir = os.getenv('WHISPER_TEMP_DIR', tempfile.gettempdir())

        # Enhanced mobile and desktop support
        self.default_beam_size = {
            'mobile': 3,      # Lower beam size for mobile performance
            'desktop': 5,     # Standard beam size for desktop
            'high_quality': 8 # High quality for critical transcriptions
        }
        
        # Device-specific optimizations
        self.device_type = self._detect_device_type()
        self.optimal_beam_size = self._get_optimal_beam_size()

        # Підтримувані формати (enhanced for mobile)
        self.allowed_extensions = {
            'wav', 'mp3', 'mp4', 'm4a', 'aac', 'ogg', 'flac', 'webm', 'opus'
        }

        self._init_whisper()
    
    def _detect_device_type(self) -> str:
        """Detects if running on mobile or desktop for optimization"""
        try:
            # Simple heuristic: check CPU count and available memory
            import psutil
            cpu_count = psutil.cpu_count()
            memory_gb = psutil.virtual_memory().total / (1024**3)
            
            # Mobile typically has fewer cores and less memory
            if cpu_count <= 4 and memory_gb <= 8:
                return 'mobile'
            else:
                return 'desktop'
        except ImportError:
            # Fallback to desktop if psutil not available
            return 'desktop'
    
    def _get_optimal_beam_size(self) -> int:
        """Gets optimal beam size based on device type"""
        if self.device_type == 'mobile':
            return self.default_beam_size['mobile']
        else:
            return self.default_beam_size['desktop']
    
    def _init_whisper(self) -> bool:
        """Ініціалізує модель Whisper."""
        if not FASTER_WHISPER_AVAILABLE:
            logger.warning("faster-whisper не доступний. STT працюватиме тільки через Web Speech API.")
            return False
        
        try:
            logger.info(f"Завантажую Whisper модель: {self.model_size} на {self.device} (compute_type={self.compute_type})")
            self.whisper_model = WhisperModel(
                self.model_size, 
                device=self.device,
                compute_type=self.compute_type
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
                       beam_size: Optional[int] = None,
                       temperature: float = 0.0,
                       optimize_for_mobile: bool = False) -> Dict[str, Any]:
        """
        Транскрибує аудіофайл за допомогою Whisper з оптимізацією для мобільних та десктоп пристроїв.
        
        Args:
            file_path: Шлях до аудіофайлу
            language: Код мови (None для автовизначення)
            beam_size: Розмір beam для пошуку (None для автовибору)
            temperature: Температура для sampling
            optimize_for_mobile: Форсувати мобільні оптимізації
        
        Returns:
            Dict з результатом транскрибації
        """
        if not self.is_whisper_available():
            raise ValueError("Whisper модель недоступна")
        
        try:
            # Determine optimal beam size
            if beam_size is None:
                if optimize_for_mobile:
                    beam_size = self.default_beam_size['mobile']
                else:
                    beam_size = self.optimal_beam_size
            
            logger.info(f"Транскрибую файл: {file_path} (beam_size={beam_size}, device_type={self.device_type})")
            
            # Enhanced parameters for mobile/desktop optimization
            transcribe_params = {
                'beam_size': beam_size,
                'temperature': temperature,
                'language': language
            }
            
            # Mobile-specific optimizations
            if optimize_for_mobile or self.device_type == 'mobile':
                transcribe_params.update({
                    'patience': 1.0,  # Faster decoding
                    'length_penalty': 1.0,  # Standard length penalty
                    'repetition_penalty': 1.1,  # Slight repetition penalty
                    'no_repeat_ngram_size': 2  # Prevent short repetitions
                })
            
            # Виконуємо транскрибацію
            segments, info = self.whisper_model.transcribe(
                file_path,
                **transcribe_params
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
        """Повертає статус STT системи з інформацією про оптимізації."""
        return {
            'whisper_available': self.is_whisper_available(),
            'whisper_model': self.model_size if self.is_whisper_available() else None,
            'device': self.device,
            'device_type': self.device_type,
            'optimal_beam_size': self.optimal_beam_size,
            'compute_type': getattr(self, 'compute_type', None),
            'supported_formats': list(self.allowed_extensions),
            'fallback_available': True,  # Web Speech API завжди доступний у браузері
            'mobile_optimizations': self.device_type == 'mobile',
        }

# Глобальний instance STT менеджера
stt_manager = STTManager()
