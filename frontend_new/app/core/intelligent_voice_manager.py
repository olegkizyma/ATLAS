#!/usr/bin/env python3
"""
ATLAS Intelligent Voice Management System
Розумна система управління голосами для Atlas, Тетяни та Гріші
"""

import re
import os
import logging
import requests
import json
from typing import Dict, Optional, Literal, Tuple
from pathlib import Path

logger = logging.getLogger(__name__)

# Типи агентів
Agent = Literal["atlas", "tetyana", "grisha"]

class IntelligentVoiceManager:
    """Розумний менеджер голосів для різних агентів системи ATLAS"""
    
    def __init__(self):
        self.voice_config = self._load_voice_config()
        # TTS endpoint (default 3001 to avoid conflict with Goose Web on 3000); override via ATLAS_TTS_URL
        self.ukrainian_tts_url = os.getenv("ATLAS_TTS_URL", "http://localhost:3001/tts")
        self.fallback_enabled = False  # Вимкнено згідно вимог - тільки розумна система
        
    def _load_voice_config(self) -> Dict:
        """Завантажити конфігурацію голосів з промптів"""
        try:
            prompts_path = Path(__file__).parent.parent.parent / "orchestrator" / "intelligeich.json"
            with open(prompts_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Не вдалося завантажити конфігурацію голосів: {e}")
            return self._get_default_config()
    
    def _get_default_config(self) -> Dict:
        """Базова конфігурація голосів (використовується тільки якщо файл не знайдено)"""
        return {
            "atlas": {
                "voice_characteristics": {
                    "tone": "мудрий, впевнений",
                    "speed": "помірна", 
                    "pitch": "низький",
                    "style": "офіційний, аналітичний"
                },
                "response_signature": "[ATLAS]"
            },
            "tetyana": {
                "voice_characteristics": {
                    "tone": "дружній, професійний",
                    "speed": "активна",
                    "pitch": "середній", 
                    "style": "практичний, детальний"
                },
                "response_signature": "[ТЕТЯНА]"
            },
            "grisha": {
                "voice_characteristics": {
                    "tone": "строгий, справедливий",
                    "speed": "рішуча",
                    "pitch": "середньо-низький",
                    "style": "критичний, аналітичний"
                },
                "response_signature": "[ГРИША]"
            }
        }
    
    def detect_speaker_from_response(self, text: str) -> Tuple[Agent, str]:
        """
        Розумне визначення спікера з тексту відповіді
        Повертає: (агент, очищений текст)
        """
        if not text:
            return "atlas", ""
        
        # Пошук підписів
        signatures = {
            "atlas": [r'\[ATLAS\]', r'\[АТЛАС\]', r'ATLAS:', r'АТЛАС:'],
            "tetyana": [r'\[ТЕТЯНА\]', r'\[TETYANA\]', r'ТЕТЯНА:', r'TETYANA:'],
            "grisha": [r'\[ГРИША\]', r'\[GRISHA\]', r'ГРИША:', r'GRISHA:']
        }
        
        for agent, patterns in signatures.items():
            for pattern in patterns:
                if re.search(pattern, text, re.IGNORECASE):
                    # Очищуємо текст від підпису
                    cleaned_text = re.sub(pattern, '', text, flags=re.IGNORECASE).strip()
                    return agent, cleaned_text
        
        # Розумний аналіз змісту для визначення спікера
        content_indicators = {
            "atlas": [
                "аналіз", "план", "стратегія", "координація", "ресурси", 
                "планувальник", "система", "підхід", "методологія"
            ],
            "tetyana": [
                "виконую", "роблю", "перевіряю", "результат", "докази", 
                "завдання виконано", "звіт", "деталі", "практично"
            ],
            "grisha": [
                "перевірка", "оцінка", "висновок", "критерії", "завершеність",
                "isComplete", "issues", "проблеми", "контроль якості"
            ]
        }
        
        text_lower = text.lower()
        scores = {agent: 0 for agent in content_indicators}
        
        for agent, indicators in content_indicators.items():
            for indicator in indicators:
                scores[agent] += text_lower.count(indicator.lower())
        
        # Визначаємо агента з найвищим скором
        best_agent = max(scores, key=scores.get)
        if scores[best_agent] > 0:
            return best_agent, text
        
        # За замовчуванням - Atlas
        return "atlas", text
    
    def get_voice_parameters(self, agent: Agent) -> Dict:
        """Отримати параметри голосу для агента"""
        agent_config = self.voice_config.get(agent, {})
        voice_chars = agent_config.get("voice_characteristics", {})
        
        # Маппінг характеристик на параметри TTS
        voice_mapping = {
            # Тон голосу
            "мудрий": {"pitch": 0.8, "speed": 0.9, "voice_type": "male_deep"},
            "дружній": {"pitch": 1.1, "speed": 1.1, "voice_type": "female_warm"},
            "строгий": {"pitch": 0.9, "speed": 1.0, "voice_type": "male_firm"},
            
            # Швидкість
            "помірна": {"speed": 0.9},
            "активна": {"speed": 1.1},
            "рішуча": {"speed": 1.0},
            
            # Висота
            "низький": {"pitch": 0.8},
            "середній": {"pitch": 1.0},
            "середньо-низький": {"pitch": 0.9}
        }
        
        # Базові параметри для агента
        base_params = {
            "atlas": {"pitch": 0.8, "speed": 0.9, "voice": "dmytro", "emotion": "confident"},
            "tetyana": {"pitch": 1.1, "speed": 1.1, "voice": "oleksa", "emotion": "friendly"},
            "grisha": {"pitch": 0.9, "speed": 1.0, "voice": "robot", "emotion": "serious"}
        }
        
        params = base_params.get(agent, base_params["atlas"]).copy()
        
        # Застосовуємо кастомізацію на основі характеристик
        tone = voice_chars.get("tone", "").lower()
        for tone_key, tone_params in voice_mapping.items():
            if tone_key in tone:
                params.update(tone_params)
                break
        
        return params
    
    def synthesize_speech(self, text: str, agent: Optional[Agent] = None) -> Dict:
        """
        Синтезувати мовлення для тексту
        Якщо агент не вказано - визначає автоматично
        """
        if agent is None:
            agent, cleaned_text = self.detect_speaker_from_response(text)
            text = cleaned_text
        
        # Додаємо підпис агента, якщо його немає
        signature = self.voice_config.get(agent, {}).get("response_signature", f"[{agent.upper()}]")
        if signature not in text:
            text = f"{signature} {text}"
        
        voice_params = self.get_voice_parameters(agent)
        
        try:
            # Відправляємо запит до українського TTS
            payload = {
                "text": text,
                "voice": voice_params.get("voice", "dmytro"),
                "speed": voice_params.get("speed", 1.0),
                "pitch": voice_params.get("pitch", 1.0),
                "emotion": voice_params.get("emotion", "neutral")
            }
            
            logger.info(f"Синтезуємо мовлення для {agent}: {voice_params}")
            
            response = requests.post(
                self.ukrainian_tts_url, 
                json=payload,
                timeout=30,
                headers={"Content-Type": "application/json"}
            )
            
            if response.status_code == 200:
                return {
                    "success": True,
                    "agent": agent,
                    "audio_data": response.content,
                    "voice_params": voice_params,
                    "text": text
                }
            else:
                logger.error(f"TTS помилка {response.status_code}: {response.text}")
                return {
                    "success": False,
                    "error": f"TTS server error: {response.status_code}",
                    "agent": agent,
                    "text": text
                }
                
        except Exception as e:
            logger.error(f"Помилка синтезу мовлення для {agent}: {e}")
            return {
                "success": False,
                "error": str(e),
                "agent": agent,
                "text": text
            }
    
    def get_agent_info(self, agent: Agent) -> Dict:
        """Отримати інформацію про агента"""
        agent_config = self.voice_config.get(agent, {})
        return {
            "name": agent,
            "signature": agent_config.get("response_signature", f"[{agent.upper()}]"),
            "characteristics": agent_config.get("voice_characteristics", {}),
            "system_prompt": agent_config.get("system", "")
        }
    
    def prepare_response_for_display(self, text: str, agent: Optional[Agent] = None) -> Dict:
        """Підготувати відповідь для відображення з голосовими мітками"""
        if agent is None:
            agent, cleaned_text = self.detect_speaker_from_response(text)
        else:
            cleaned_text = text
            
        agent_info = self.get_agent_info(agent)
        
        return {
            "agent": agent,
            "signature": agent_info["signature"],
            "text": cleaned_text,
            "display_text": f"{agent_info['signature']} {cleaned_text}",
            "voice_characteristics": agent_info["characteristics"],
            "ready_for_tts": True
        }