#!/usr/bin/env python3
"""
ATLAS Dynamic Configuration Manager
Повністю динамічний менеджер конфігурацій без хардкорів
"""

import json
import logging
import time
import os
from typing import Dict, Any, Optional
from pathlib import Path
import aiohttp

logger = logging.getLogger('atlas.dynamic_config')

class DynamicConfigManager:
    """Менеджер динамічних конфігурацій з AI-генерацією"""
    
    def __init__(self):
        self.ai_api_base = "http://127.0.0.1:3010/v1"
        self.config_cache = {}
        self.last_generated = 0
        self.cache_ttl = 3600  # 1 година
        
        # Контекст системи для генерації конфігурацій
        self.system_context = self._gather_system_context()
    
    def _gather_system_context(self) -> Dict[str, Any]:
        """Збирає контекст системи для генерації конфігурацій"""
        
        context = {
            'timestamp': time.time(),
            'python_version': f"{os.sys.version_info.major}.{os.sys.version_info.minor}",
            'platform': os.name,
            'working_directory': str(Path.cwd()),
            'environment_variables': {
                key: value for key, value in os.environ.items() 
                if any(keyword in key.lower() for keyword in ['atlas', 'goose', 'tts', 'whisper', 'ai', 'api'])
            }
        }
        
        # Додаємо системні ресурси якщо можливо
        try:
            import psutil
            context['system_resources'] = {
                'cpu_count': psutil.cpu_count(),
                'memory_total_gb': round(psutil.virtual_memory().total / (1024**3), 2),
                'memory_available_gb': round(psutil.virtual_memory().available / (1024**3), 2),
                'disk_free_gb': round(psutil.disk_usage('/').free / (1024**3), 2)
            }
        except ImportError:
            context['system_resources'] = {
                'cpu_count': os.cpu_count() or 2,
                'memory_total_gb': 4.0,  # Припущення
                'memory_available_gb': 2.0,
                'disk_free_gb': 10.0
            }
        
        return context
    
    async def generate_intelligent_config(self, config_type: str = "complete") -> Dict[str, Any]:
        """Генерує інтелігентну конфігурацію через AI"""
        
        current_time = time.time()
        
        # Перевіряємо кеш
        cache_key = f"{config_type}_{current_time // self.cache_ttl}"
        if cache_key in self.config_cache:
            logger.info(f"Using cached config for {config_type}")
            return self.config_cache[cache_key]
        
        logger.info(f"🔧 Generating dynamic config: {config_type}")
        
        try:
            # Генеруємо конфігурацію через AI
            config = await self._generate_config_via_ai(config_type)
            
            # Валідуємо згенеровану конфігурацію
            validated_config = self._validate_and_enhance_config(config, config_type)
            
            # Кешуємо результат
            self.config_cache[cache_key] = validated_config
            self.last_generated = current_time
            
            logger.info(f"✅ Dynamic config generated: {len(validated_config)} sections")
            return validated_config
            
        except Exception as e:
            logger.error(f"❌ Failed to generate config via AI: {e}")
            
            # Fallback до базової конфігурації
            fallback_config = self._generate_fallback_config(config_type)
            self.config_cache[cache_key] = fallback_config
            return fallback_config
    
    async def _generate_config_via_ai(self, config_type: str) -> Dict[str, Any]:
        """Генерує конфігурацію через AI API"""
        
        # Створюємо деталізований промпт для AI
        system_prompt = """
Ти - експерт з конфігурації AI систем. Твоє завдання - згенерувати оптимальну конфігурацію для системи ATLAS.

ATLAS - це інтелігентна система з 3 агентами:
- Atlas: планувальник та стратег (використовує AI API)
- Tetyana: виконавець завдань (використовує Goose + AI API)  
- Grisha: валідатор результатів (використовує AI API + Goose для перевірки)

Система використовує:
- Локальне AI API на порті 3010 (OpenAI-compatible)
- Goose на порті 3000 для реального виконання завдань
- TTS сервер на порті 3001 для української синтезації мови
- Whisper для розпізнання мови
- Веб-інтерфейс на порті 5001

Принципи конфігурації:
1. ZERO HARDCODE - всі значення мають бути динамічними
2. SUPER RELIABILITY - мінімальні шанси на відмову
3. INTELLIGENT ADAPTATION - адаптація до ресурсів системи
4. PERFORMANCE OPTIMIZATION - максимальна ефективність

Поверни ТІЛЬКИ JSON конфігурацію без додаткових пояснень.
"""
        
        user_prompt = f"""
Згенеруй {config_type} конфігурацію для ATLAS системи.

Контекст системи:
{json.dumps(self.system_context, indent=2, ensure_ascii=False)}

Конфігурація має включати:

1. SYSTEM - загальні налаштування системи
2. AGENTS - конфігурація для кожного агента (Atlas, Tetyana, Grisha)
3. AI_API - налаштування для локального AI API
4. GOOSE - конфігурація Goose executor
5. VOICE - налаштування TTS/STT системи
6. WEB - налаштування веб-інтерфейсу
7. PERFORMANCE - оптимізації продуктивності
8. RELIABILITY - налаштування надійності

Кожна секція має включати:
- timeout значення адаптовані до ресурсів
- retry policies для надійності
- adaptive parameters що змінюються в залежності від навантаження
- resource limits базовані на доступних ресурсах
- intelligent fallback strategies

Враховуй наявні ресурси системи для оптимізації налаштувань.
"""
        
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "stream": False,
                    "temperature": 0.3  # Низька температура для консистентності
                }
                
                async with session.post(
                    f"{self.ai_api_base}/chat/completions",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as response:
                    
                    if response.status == 200:
                        ai_response = await response.json()
                        content = ai_response['choices'][0]['message']['content']
                        
                        # Витягуємо JSON з відповіді
                        import re
                        json_match = re.search(r'\{.*\}', content, re.DOTALL)
                        if json_match:
                            return json.loads(json_match.group(0))
                        else:
                            raise Exception("No JSON found in AI response")
                    else:
                        raise Exception(f"AI API returned status {response.status}")
                        
        except Exception as e:
            logger.error(f"AI config generation failed: {e}")
            raise
    
    def _validate_and_enhance_config(self, config: Dict[str, Any], config_type: str) -> Dict[str, Any]:
        """Валідує та покращує згенеровану конфігурацію"""
        
        # Гарантуємо наявність базових секцій
        required_sections = ['SYSTEM', 'AGENTS', 'AI_API', 'GOOSE', 'VOICE', 'WEB', 'PERFORMANCE', 'RELIABILITY']
        
        for section in required_sections:
            if section not in config:
                config[section] = {}
        
        # Валідуємо та корегуємо системні налаштування
        self._validate_system_section(config['SYSTEM'])
        self._validate_agents_section(config['AGENTS'])
        self._validate_ai_api_section(config['AI_API'])
        self._validate_goose_section(config['GOOSE'])
        self._validate_voice_section(config['VOICE'])
        self._validate_web_section(config['WEB'])
        self._validate_performance_section(config['PERFORMANCE'])
        self._validate_reliability_section(config['RELIABILITY'])
        
        # Додаємо метаінформацію
        config['META'] = {
            'generated_at': time.time(),
            'generated_by': 'AI',
            'config_type': config_type,
            'system_context_hash': hash(str(self.system_context)),
            'version': '1.0'
        }
        
        return config
    
    def _validate_system_section(self, system_config: Dict[str, Any]):
        """Валідує системну секцію"""
        defaults = {
            'max_concurrent_requests': min(10, max(2, self.system_context['system_resources']['cpu_count'])),
            'request_timeout_seconds': 30,
            'health_check_interval_seconds': 60,
            'log_level': 'INFO',
            'debug_mode': False
        }
        
        for key, default_value in defaults.items():
            if key not in system_config:
                system_config[key] = default_value
    
    def _validate_agents_section(self, agents_config: Dict[str, Any]):
        """Валідує секцію агентів"""
        required_agents = ['atlas', 'tetyana', 'grisha']
        
        for agent in required_agents:
            if agent not in agents_config:
                agents_config[agent] = {}
            
            agent_config = agents_config[agent]
            
            # Базові налаштування для кожного агента
            defaults = {
                'timeout_seconds': 30 if agent == 'atlas' else (60 if agent == 'tetyana' else 20),
                'max_retries': 3,
                'retry_delay_seconds': 1,
                'max_context_tokens': 8000 if agent == 'atlas' else (12000 if agent == 'tetyana' else 10000),
                'enabled': True
            }
            
            for key, default_value in defaults.items():
                if key not in agent_config:
                    agent_config[key] = default_value
    
    def _validate_ai_api_section(self, ai_config: Dict[str, Any]):
        """Валідує секцію AI API"""
        defaults = {
            'base_url': 'http://127.0.0.1:3010/v1',
            'model': 'gpt-4o-mini',
            'timeout_seconds': 30,
            'max_retries': 3,
            'retry_delay_seconds': 2,
            'temperature': 0.7,
            'max_tokens': None
        }
        
        for key, default_value in defaults.items():
            if key not in ai_config:
                ai_config[key] = default_value
    
    def _validate_goose_section(self, goose_config: Dict[str, Any]):
        """Валідує секцію Goose"""
        defaults = {
            'base_url': 'http://127.0.0.1:3000',
            'timeout_seconds': 60,
            'max_retries': 2,
            'retry_delay_seconds': 5,
            'health_check_interval_seconds': 30,
            'enable_tools': True
        }
        
        for key, default_value in defaults.items():
            if key not in goose_config:
                goose_config[key] = default_value
    
    def _validate_voice_section(self, voice_config: Dict[str, Any]):
        """Валідує секцію голосу"""
        defaults = {
            'tts_enabled': True,
            'tts_url': 'http://127.0.0.1:3001',
            'tts_timeout_seconds': 10,
            'stt_enabled': True,
            'stt_timeout_seconds': 15,
            'stt_model': 'large-v3',
            'default_voice': 'dmytro',
            'language': 'uk-UA'
        }
        
        for key, default_value in defaults.items():
            if key not in voice_config:
                voice_config[key] = default_value
    
    def _validate_web_section(self, web_config: Dict[str, Any]):
        """Валідує секцію веб-інтерфейсу"""
        defaults = {
            'port': 5001,
            'host': '127.0.0.1',
            'debug': False,
            'auto_reload': False,
            'max_content_length': 16 * 1024 * 1024,  # 16MB
            'request_timeout_seconds': 30
        }
        
        for key, default_value in defaults.items():
            if key not in web_config:
                web_config[key] = default_value
    
    def _validate_performance_section(self, perf_config: Dict[str, Any]):
        """Валідує секцію продуктивності"""
        cpu_count = self.system_context['system_resources']['cpu_count']
        memory_gb = self.system_context['system_resources']['memory_available_gb']
        
        defaults = {
            'worker_processes': min(cpu_count, 4),
            'worker_threads': cpu_count * 2,
            'memory_limit_mb': int(memory_gb * 0.5 * 1024),  # 50% доступної пам'яті
            'cache_enabled': memory_gb > 1.0,
            'cache_size_mb': min(int(memory_gb * 0.1 * 1024), 512),
            'connection_pool_size': min(cpu_count * 5, 20)
        }
        
        for key, default_value in defaults.items():
            if key not in perf_config:
                perf_config[key] = default_value
    
    def _validate_reliability_section(self, rel_config: Dict[str, Any]):
        """Валідує секцію надійності"""
        defaults = {
            'enable_auto_recovery': True,
            'max_recovery_attempts': 5,
            'circuit_breaker_enabled': True,
            'circuit_breaker_threshold': 5,
            'circuit_breaker_timeout_seconds': 60,
            'health_check_enabled': True,
            'graceful_shutdown_timeout_seconds': 30
        }
        
        for key, default_value in defaults.items():
            if key not in rel_config:
                rel_config[key] = default_value
    
    def _generate_fallback_config(self, config_type: str) -> Dict[str, Any]:
        """Генерує базову fallback конфігурацію"""
        
        cpu_count = self.system_context['system_resources']['cpu_count']
        memory_gb = self.system_context['system_resources']['memory_available_gb']
        
        return {
            'SYSTEM': {
                'max_concurrent_requests': min(cpu_count, 5),
                'request_timeout_seconds': 30,
                'health_check_interval_seconds': 60,
                'log_level': 'INFO',
                'debug_mode': False
            },
            'AGENTS': {
                'atlas': {
                    'timeout_seconds': 15,
                    'max_retries': 3,
                    'max_context_tokens': 8000,
                    'enabled': True
                },
                'tetyana': {
                    'timeout_seconds': 60,
                    'max_retries': 2,
                    'max_context_tokens': 12000,
                    'enabled': True,
                    'requires_goose': True
                },
                'grisha': {
                    'timeout_seconds': 20,
                    'max_retries': 3,
                    'max_context_tokens': 10000,
                    'enabled': True
                }
            },
            'AI_API': {
                'base_url': 'http://127.0.0.1:3010/v1',
                'model': 'gpt-4o-mini',
                'timeout_seconds': 30,
                'max_retries': 3,
                'temperature': 0.7
            },
            'GOOSE': {
                'base_url': 'http://127.0.0.1:3000',
                'timeout_seconds': 60,
                'max_retries': 2,
                'enable_tools': True
            },
            'VOICE': {
                'tts_enabled': True,
                'tts_url': 'http://127.0.0.1:3001',
                'tts_timeout_seconds': 10,
                'stt_enabled': True,
                'stt_timeout_seconds': 15,
                'stt_model': 'large-v3'
            },
            'WEB': {
                'port': 5001,
                'host': '127.0.0.1',
                'debug': False
            },
            'PERFORMANCE': {
                'worker_processes': min(cpu_count, 2),
                'memory_limit_mb': int(memory_gb * 0.5 * 1024),
                'cache_enabled': memory_gb > 1.0
            },
            'RELIABILITY': {
                'enable_auto_recovery': True,
                'max_recovery_attempts': 3,
                'circuit_breaker_enabled': True
            },
            'META': {
                'generated_at': time.time(),
                'generated_by': 'fallback',
                'config_type': config_type,
                'version': '1.0'
            }
        }
    
    async def get_config_for_service(self, service_name: str) -> Dict[str, Any]:
        """Повертає конфігурацію для конкретного сервісу"""
        
        full_config = await self.generate_intelligent_config()
        
        # Маппінг сервісів до секцій конфігурації
        service_mapping = {
            'intelligent_engine': ['SYSTEM', 'AI_API', 'PERFORMANCE', 'RELIABILITY'],
            'goose_executor': ['GOOSE', 'RELIABILITY'],
            'agent_system': ['AGENTS', 'AI_API'],
            'voice_system': ['VOICE'],
            'web_interface': ['WEB', 'PERFORMANCE']
        }
        
        relevant_sections = service_mapping.get(service_name, ['SYSTEM'])
        
        service_config = {}
        for section in relevant_sections:
            if section in full_config:
                service_config[section.lower()] = full_config[section]
        
        return service_config
    
    def get_cached_config(self) -> Optional[Dict[str, Any]]:
        """Повертає кешовану конфігурацію якщо є"""
        if not self.config_cache:
            return None
        
        # Повертаємо найновішу конфігурацію з кешу
        latest_key = max(self.config_cache.keys())
        return self.config_cache[latest_key]
    
    def clear_cache(self):
        """Очищає кеш конфігурацій"""
        self.config_cache.clear()
        logger.info("Configuration cache cleared")