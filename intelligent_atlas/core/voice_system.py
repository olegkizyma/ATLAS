#!/usr/bin/env python3
"""
ATLAS Voice System
Інтеграція TTS/STT для голосового інтерфейсу
"""

import asyncio
import json
import logging
import time
import tempfile
import os
from typing import Dict, Any, Optional, List
from dataclasses import dataclass
import aiohttp

logger = logging.getLogger('atlas.voice_system')

@dataclass
class VoiceRequest:
    """Запит на озвучування"""
    text: str
    agent: str = 'atlas'
    voice: str = 'dmytro'
    language: str = 'uk-UA'

@dataclass 
class STTRequest:
    """Запит на розпізнавання мови"""
    audio_file: str
    language: str = 'uk'
    model: str = 'large-v3'

class VoiceSystem:
    """Система голосового інтерфейсу з TTS та STT"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        
        # TTS конфігурація
        self.tts_enabled = config.get('tts_enabled', True)
        self.tts_base_url = config.get('tts_url', 'http://127.0.0.1:3001')
        self.tts_timeout = config.get('tts_timeout_seconds', 10)
        
        # STT конфігурація  
        self.stt_enabled = config.get('stt_enabled', True)
        self.stt_timeout = config.get('stt_timeout_seconds', 15)
        
        # Голоси агентів
        self.agent_voices = {
            'atlas': {
                'voice': 'dmytro',
                'signature': '[ATLAS]',
                'color': '#00ff00',
                'rate': 1.0,
                'pitch': 1.0
            },
            'tetyana': {
                'voice': 'tetiana',
                'signature': '[ТЕТЯНА]', 
                'color': '#00ffff',
                'rate': 1.0,
                'pitch': 1.05
            },
            'grisha': {
                'voice': 'mykyta',
                'signature': '[ГРИША]',
                'color': '#ffff00',
                'rate': 1.1,
                'pitch': 0.9
            }
        }
        
        # Статистика
        self.stats = {
            'tts_requests': 0,
            'tts_successful': 0,
            'tts_failed': 0,
            'stt_requests': 0,
            'stt_successful': 0,
            'stt_failed': 0,
            'average_tts_time': 0,
            'average_stt_time': 0
        }
        
        # Статус системи
        self.tts_available = False
        self.stt_available = False
        self.last_health_check = 0
        self.health_check_interval = 60
    
    async def initialize(self) -> bool:
        """Ініціалізує голосову систему"""
        logger.info("🎤 Initializing Voice System...")
        
        try:
            # Перевіряємо доступність TTS
            if self.tts_enabled:
                self.tts_available = await self._check_tts_health()
                if self.tts_available:
                    logger.info("✅ TTS system available")
                else:
                    logger.warning("⚠️ TTS system not available")
            
            # Перевіряємо доступність STT (Whisper)
            if self.stt_enabled:
                self.stt_available = await self._check_stt_health()
                if self.stt_available:
                    logger.info("✅ STT system available")
                else:
                    logger.warning("⚠️ STT system not available")
            
            logger.info("✅ Voice System initialized")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Voice System: {e}")
            return False
    
    async def _check_tts_health(self) -> bool:
        """Перевіряє здоров'я TTS системи"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.tts_base_url}/health",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as response:
                    return response.status == 200
        except:
            try:
                # Fallback - перевіряємо /voices endpoint
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{self.tts_base_url}/voices",
                        timeout=aiohttp.ClientTimeout(total=5)
                    ) as response:
                        return response.status == 200
            except:
                return False
    
    async def _check_stt_health(self) -> bool:
        """Перевіряє здоров'я STT системи"""
        try:
            # Перевіряємо наявність faster-whisper
            import faster_whisper
            return True
        except ImportError:
            logger.warning("faster-whisper not available")
            return False
    
    async def health_check(self) -> bool:
        """Перевіряє стан голосової системи"""
        current_time = time.time()
        
        if current_time - self.last_health_check < self.health_check_interval:
            return self.tts_available or self.stt_available
        
        if self.tts_enabled:
            self.tts_available = await self._check_tts_health()
        
        if self.stt_enabled:
            self.stt_available = await self._check_stt_health()
        
        self.last_health_check = current_time
        return self.tts_available or self.stt_available
    
    async def synthesize_speech(self, request: VoiceRequest) -> Optional[bytes]:
        """Синтезує мову з тексту"""
        if not self.tts_enabled or not self.tts_available:
            logger.warning("TTS not available")
            return None
        
        start_time = time.time()
        self.stats['tts_requests'] += 1
        
        try:
            # Отримуємо налаштування для агента
            agent_config = self.agent_voices.get(request.agent, self.agent_voices['atlas'])
            
            # Очищаємо текст від підписів агентів
            clean_text = self._clean_text_for_tts(request.text, agent_config['signature'])
            
            if not clean_text.strip():
                logger.warning("Empty text for TTS")
                return None
            
            # Формуємо запит до TTS API
            tts_payload = {
                'text': clean_text,
                'voice': request.voice or agent_config['voice'],
                'speed': agent_config.get('rate', 1.0),
                'return_audio': True
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.tts_base_url}/tts",
                    json=tts_payload,
                    timeout=aiohttp.ClientTimeout(total=self.tts_timeout)
                ) as response:
                    
                    if response.status == 200:
                        audio_data = await response.read()
                        
                        execution_time = time.time() - start_time
                        self._update_tts_stats(execution_time, True)
                        
                        logger.info(f"✅ TTS synthesis successful: {len(audio_data)} bytes in {execution_time:.2f}s")
                        return audio_data
                    else:
                        error_text = await response.text()
                        logger.error(f"TTS API error {response.status}: {error_text}")
                        
        except Exception as e:
            logger.error(f"❌ TTS synthesis failed: {e}")
        
        execution_time = time.time() - start_time
        self._update_tts_stats(execution_time, False)
        return None
    
    def _clean_text_for_tts(self, text: str, signature: str) -> str:
        """Очищає текст для TTS"""
        import re
        
        # Видаляємо підписи агентів
        clean_text = text.replace(signature, '').strip()
        
        # Видаляємо квадратні дужки з підписами
        clean_text = re.sub(r'\[[^\]]+\]\s*', '', clean_text)
        
        # Видаляємо надмірні пробіли
        clean_text = re.sub(r'\s+', ' ', clean_text).strip()
        
        return clean_text
    
    async def transcribe_audio(self, request: STTRequest) -> Optional[Dict[str, Any]]:
        """Розпізнає мову з аудіо"""
        if not self.stt_enabled or not self.stt_available:
            logger.warning("STT not available")
            return None
        
        start_time = time.time()
        self.stats['stt_requests'] += 1
        
        try:
            # Імпортуємо Whisper
            from faster_whisper import WhisperModel
            
            # Ініціалізуємо модель (кешується)
            if not hasattr(self, '_whisper_model'):
                device = 'cpu'  # Безпечний варіант
                compute_type = 'int8'
                
                # Спробуємо визначити кращі налаштування
                try:
                    import torch
                    if torch.backends.mps.is_available():
                        device = 'auto'  # Metal на macOS
                    elif torch.cuda.is_available():
                        device = 'cuda'
                        compute_type = 'float16'
                except:
                    pass
                
                logger.info(f"Loading Whisper model {request.model} on {device}")
                self._whisper_model = WhisperModel(
                    request.model,
                    device=device,
                    compute_type=compute_type
                )
            
            # Розпізнаємо аудіо
            segments, info = self._whisper_model.transcribe(
                request.audio_file,
                beam_size=5,
                language=request.language,
                temperature=0.0
            )
            
            # Збираємо результат
            full_text = ""
            segments_list = []
            
            for segment in segments:
                segment_data = {
                    'start': segment.start,
                    'end': segment.end,
                    'text': segment.text
                }
                segments_list.append(segment_data)
                full_text += segment.text
            
            execution_time = time.time() - start_time
            self._update_stt_stats(execution_time, True)
            
            result = {
                'success': True,
                'text': full_text.strip(),
                'language': info.language,
                'language_probability': info.language_probability,
                'duration': info.duration,
                'segments': segments_list,
                'execution_time': execution_time
            }
            
            logger.info(f"✅ STT transcription successful: '{full_text[:100]}...' in {execution_time:.2f}s")
            return result
            
        except Exception as e:
            logger.error(f"❌ STT transcription failed: {e}")
            execution_time = time.time() - start_time
            self._update_stt_stats(execution_time, False)
            
            return {
                'success': False,
                'error': str(e),
                'execution_time': execution_time
            }
    
    def _update_tts_stats(self, execution_time: float, success: bool):
        """Оновлює статистику TTS"""
        if success:
            self.stats['tts_successful'] += 1
        else:
            self.stats['tts_failed'] += 1
        
        # Оновлюємо середній час
        total = self.stats['tts_requests']
        current_avg = self.stats['average_tts_time']
        self.stats['average_tts_time'] = (current_avg * (total - 1) + execution_time) / total
    
    def _update_stt_stats(self, execution_time: float, success: bool):
        """Оновлює статистику STT"""
        if success:
            self.stats['stt_successful'] += 1
        else:
            self.stats['stt_failed'] += 1
        
        # Оновлюємо середній час
        total = self.stats['stt_requests']
        current_avg = self.stats['average_stt_time']
        self.stats['average_stt_time'] = (current_avg * (total - 1) + execution_time) / total
    
    async def get_available_voices(self) -> List[Dict[str, Any]]:
        """Повертає список доступних голосів"""
        if not self.tts_available:
            return []
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{self.tts_base_url}/voices",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as response:
                    
                    if response.status == 200:
                        data = await response.json()
                        
                        # Нормалізуємо формат
                        voices = []
                        raw_voices = data if isinstance(data, list) else data.get('voices', [])
                        
                        for voice in raw_voices:
                            if isinstance(voice, dict):
                                voices.append({
                                    'name': voice.get('name', voice.get('id', '')),
                                    'locale': voice.get('locale', voice.get('lang', 'uk-UA'))
                                })
                            elif isinstance(voice, str):
                                voices.append({
                                    'name': voice,
                                    'locale': 'uk-UA'
                                })
                        
                        return voices
        except Exception as e:
            logger.error(f"Failed to get available voices: {e}")
        
        # Fallback список
        return [
            {'name': 'dmytro', 'locale': 'uk-UA'},
            {'name': 'tetiana', 'locale': 'uk-UA'},
            {'name': 'mykyta', 'locale': 'uk-UA'},
            {'name': 'oleksa', 'locale': 'uk-UA'}
        ]
    
    async def prepare_voice_response(self, text: str) -> Dict[str, Any]:
        """Підготовує текст для озвучування"""
        
        # Визначаємо агента за підписом
        agent = 'atlas'
        for agent_name, config in self.agent_voices.items():
            if config['signature'] in text:
                agent = agent_name
                break
        
        # Очищаємо текст
        agent_config = self.agent_voices[agent]
        clean_text = self._clean_text_for_tts(text, agent_config['signature'])
        
        return {
            'success': True,
            'text': clean_text,
            'agent': agent,
            'voice': agent_config['voice'],
            'signature': agent_config['signature']
        }
    
    async def get_status(self) -> Dict[str, Any]:
        """Повертає статус голосової системи"""
        await self.health_check()  # Оновлюємо статус
        
        return {
            'tts_enabled': self.tts_enabled,
            'tts_available': self.tts_available,
            'tts_url': self.tts_base_url,
            'stt_enabled': self.stt_enabled, 
            'stt_available': self.stt_available,
            'agent_voices': self.agent_voices,
            'statistics': self.stats.copy(),
            'last_health_check': self.last_health_check
        }
    
    async def shutdown(self):
        """Завершує роботу голосової системи"""
        logger.info("🔄 Shutting down Voice System...")
        
        # Очищаємо Whisper модель якщо завантажена
        if hasattr(self, '_whisper_model'):
            del self._whisper_model
        
        logger.info("✅ Voice System shutdown complete")