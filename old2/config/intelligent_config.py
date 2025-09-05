#!/usr/bin/env python3
"""
ATLAS Intelligent Configuration System
Повністю адаптивна система конфігурації без хардкорів
"""

import os
import json
import yaml
import time
import logging
from typing import Dict, Any, Optional, Union
from pathlib import Path
from dataclasses import dataclass, field
from abc import ABC, abstractmethod

logger = logging.getLogger('atlas.intelligent_config')

@dataclass
class IntelligentParameter:
    """Інтелектуальний параметр з автоматичною адаптацією"""
    name: str
    value: Any = None
    auto_adapt: bool = True
    constraints: Dict[str, Any] = field(default_factory=dict)
    dependencies: list = field(default_factory=list)
    learning_history: list = field(default_factory=list)
    
    def adapt_value(self, context: Dict[str, Any]) -> Any:
        """Адаптує значення базуючись на контексті"""
        if not self.auto_adapt:
            return self.value
            
        # Аналіз контексту для автоматичної адаптації
        if 'system_resources' in context:
            self._adapt_to_resources(context['system_resources'])
        
        if 'usage_patterns' in context:
            self._adapt_to_usage(context['usage_patterns'])
            
        if 'performance_metrics' in context:
            self._adapt_to_performance(context['performance_metrics'])
            
        return self.value
    
    def _adapt_to_resources(self, resources: Dict[str, Any]):
        """Адаптація до системних ресурсів"""
        if 'memory' in resources and self.name.endswith('_limit'):
            # Автоматична адаптація лімітів базуючись на доступній пам'яті
            available_memory = resources['memory'].get('available', 1024)
            if available_memory < 512:  # Низька пам'ять
                self.value = min(self.value or 1000, 500)
            elif available_memory > 4096:  # Висока пам'ять  
                self.value = max(self.value or 1000, 2000)
    
    def _adapt_to_usage(self, patterns: Dict[str, Any]):
        """Адаптація до патернів використання"""
        if 'request_frequency' in patterns and self.name.endswith('_timeout'):
            freq = patterns['request_frequency']
            if freq > 100:  # Високе навантаження
                self.value = (self.value or 30) * 0.8  # Зменшуємо таймаут
            elif freq < 10:  # Низьке навантаження
                self.value = (self.value or 30) * 1.2  # Збільшуємо таймаут
    
    def _adapt_to_performance(self, metrics: Dict[str, Any]):
        """Адаптація до метрик продуктивності"""
        if 'response_time' in metrics and self.name.endswith('_attempts'):
            avg_response = metrics['response_time'].get('average', 1.0)
            if avg_response > 5.0:  # Повільні відповіді
                self.value = max(self.value or 3, 5)  # Більше спроб
            elif avg_response < 1.0:  # Швидкі відповіді
                self.value = min(self.value or 3, 2)  # Менше спроб

class ConfigurationStrategy(ABC):
    """Абстрактна стратегія конфігурації"""
    
    @abstractmethod
    def generate_config(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Генерує конфігурацію базуючись на контексті"""
        pass
    
    @abstractmethod
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Валідує згенеровану конфігурацію"""
        pass

class ResourceAwareStrategy(ConfigurationStrategy):
    """Стратегія, що враховує системні ресурси"""
    
    def generate_config(self, context: Dict[str, Any]) -> Dict[str, Any]:
        system_info = self._get_system_info()
        
        config = {
            'server': self._generate_server_config(system_info),
            'limits': self._generate_limits_config(system_info),
            'performance': self._generate_performance_config(system_info),
            'security': self._generate_security_config(system_info)
        }
        
        return config
    
    def _get_system_info(self) -> Dict[str, Any]:
        """Отримує інформацію про систему"""
        try:
            import psutil
            
            # Безпечне отримання мережевих з'єднань
            try:
                network_connections = len(psutil.net_connections())
            except (psutil.AccessDenied, PermissionError, OSError):
                network_connections = 10  # Fallback значення
            
            return {
                'cpu_count': psutil.cpu_count(),
                'memory_total': psutil.virtual_memory().total // (1024*1024),
                'memory_available': psutil.virtual_memory().available // (1024*1024),
                'disk_space': psutil.disk_usage('/').free // (1024*1024*1024),
                'network_connections': network_connections,
                'load_average': psutil.getloadavg() if hasattr(psutil, 'getloadavg') else (0.5, 0.5, 0.5)
            }
        except ImportError:
            # Fallback для випадків коли psutil недоступний
            import os
            import multiprocessing
            
            return {
                'cpu_count': multiprocessing.cpu_count(),
                'memory_total': 4096,  # Fallback 4GB
                'memory_available': 2048,  # Fallback 2GB
                'disk_space': 50,  # Fallback 50GB
                'network_connections': 10,  # Fallback
                'load_average': (0.5, 0.5, 0.5)  # Fallback
            }
    
    def _generate_server_config(self, system_info: Dict[str, Any]) -> Dict[str, Any]:
        """Генерує конфігурацію сервера"""
        cpu_count = system_info['cpu_count']
        memory_mb = system_info['memory_available']
        
        return {
            'host': '127.0.0.1',
            'port': self._find_available_port(5000),
            'workers': min(cpu_count * 2, 8) if cpu_count > 1 else 1,
            'threads': min(cpu_count * 4, 16),
            'memory_limit_mb': min(memory_mb // 2, 1024),
            'debug': memory_mb > 2048,  # Debug тільки при достатній пам'яті
            'auto_reload': False  # Завжди вимкнено для стабільності
        }
    
    def _generate_limits_config(self, system_info: Dict[str, Any]) -> Dict[str, Any]:
        """Генерує конфігурацію лімітів"""
        memory_mb = system_info['memory_available']
        cpu_count = system_info['cpu_count']
        
        # Базові ліміти залежать від доступних ресурсів
        base_multiplier = min(memory_mb / 1024, 4.0)  # Макс 4x для 4GB+ RAM
        
        return {
            'max_context_tokens': int(30000 * base_multiplier),
            'max_requests_per_minute': min(100 * cpu_count, 500),
            'max_concurrent_requests': min(cpu_count * 2, 10),
            'timeout_seconds': 30 if memory_mb > 1024 else 60,
            'retry_attempts': 3 if cpu_count > 2 else 5,
            'backoff_base_ms': 200 if cpu_count > 2 else 500,
            'backoff_max_ms': 5000 if cpu_count > 2 else 10000
        }
    
    def _generate_performance_config(self, system_info: Dict[str, Any]) -> Dict[str, Any]:
        """Генерує конфігурацію продуктивності"""
        memory_mb = system_info['memory_available']
        load_avg = system_info['load_average'][0]
        
        return {
            'cache_enabled': memory_mb > 512,
            'cache_size_mb': min(memory_mb // 8, 256),
            'compression_enabled': True,
            'compression_level': 6 if load_avg < 1.0 else 3,
            'connection_pool_size': min(system_info['cpu_count'] * 5, 20),
            'keep_alive_timeout': 30 if memory_mb > 1024 else 15,
            'buffer_size': 8192 if memory_mb > 1024 else 4096
        }
    
    def _generate_security_config(self, system_info: Dict[str, Any]) -> Dict[str, Any]:
        """Генерує конфігурацію безпеки"""
        return {
            'secret_key': self._generate_secret_key(),
            'cors_origins': ['http://127.0.0.1:*', 'http://localhost:*'],
            'rate_limiting_enabled': True,
            'session_timeout_minutes': 60,
            'max_login_attempts': 5,
            'password_min_length': 8,
            'require_https': False,  # Для локальної розробки
            'audit_logging': True
        }
    
    def _find_available_port(self, start_port: int) -> int:
        """Знаходить доступний порт"""
        import socket
        
        for port in range(start_port, start_port + 100):
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                try:
                    s.bind(('127.0.0.1', port))
                    return port
                except OSError:
                    continue
        
        return start_port  # Fallback
    
    def _generate_secret_key(self) -> str:
        """Генерує унікальний секретний ключ"""
        import secrets
        import hashlib
        import time
        
        entropy = f"{secrets.token_hex(32)}{time.time()}{os.getpid()}"
        return hashlib.sha256(entropy.encode()).hexdigest()[:32]
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Валідує згенеровану конфігурацію"""
        required_sections = ['server', 'limits', 'performance', 'security']
        
        for section in required_sections:
            if section not in config:
                logger.error(f"Missing required config section: {section}")
                return False
        
        # Валідація серверної конфігурації
        server = config['server']
        if not (1024 <= server.get('port', 0) <= 65535):
            logger.error(f"Invalid port: {server.get('port')}")
            return False
        
        # Валідація лімітів
        limits = config['limits']
        if limits.get('max_context_tokens', 0) <= 0:
            logger.error("Invalid max_context_tokens")
            return False
        
        return True

class UsagePatternStrategy(ConfigurationStrategy):
    """Стратегія, що враховує патерни використання"""
    
    def __init__(self):
        self.usage_history_file = Path("usage_patterns.json")
        self.usage_patterns = self._load_usage_patterns()
    
    def _load_usage_patterns(self) -> Dict[str, Any]:
        """Завантажує історію використання"""
        if self.usage_history_file.exists():
            try:
                with open(self.usage_history_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Could not load usage patterns: {e}")
        
        # Повертаємо базові патерни
        return {
            'request_frequency': 10,
            'peak_hours': [9, 10, 11, 14, 15, 16],
            'average_session_duration': 30,
            'common_operations': ['search', 'analysis', 'generation'],
            'error_rate': 0.05,
            'response_times': {'average': 2.0, 'p95': 5.0}
        }
    
    def generate_config(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Генерує конфігурацію базуючись на патернах використання"""
        current_hour = context.get('current_hour', 12)
        
        config = {
            'adaptive_limits': self._generate_adaptive_limits(current_hour),
            'caching_strategy': self._generate_caching_strategy(),
            'resource_allocation': self._generate_resource_allocation(),
            'monitoring': self._generate_monitoring_config()
        }
        
        return config
    
    def _generate_adaptive_limits(self, current_hour: int) -> Dict[str, Any]:
        """Генерує адаптивні ліміти"""
        is_peak_hour = current_hour in self.usage_patterns['peak_hours']
        base_multiplier = 1.5 if is_peak_hour else 0.8
        
        return {
            'max_concurrent_requests': int(10 * base_multiplier),
            'rate_limit_per_minute': int(100 * base_multiplier),
            'timeout_seconds': 20 if is_peak_hour else 45,
            'queue_size': int(50 * base_multiplier)
        }
    
    def _generate_caching_strategy(self) -> Dict[str, Any]:
        """Генерує стратегію кешування"""
        common_ops = self.usage_patterns['common_operations']
        
        return {
            'enabled': True,
            'cache_common_operations': common_ops,
            'cache_duration_minutes': 30,
            'preload_popular_content': True,
            'cache_size_limit_mb': 128
        }
    
    def _generate_resource_allocation(self) -> Dict[str, Any]:
        """Генерує розподіл ресурсів"""
        avg_duration = self.usage_patterns['average_session_duration']
        
        return {
            'session_pool_size': max(20, int(avg_duration / 2)),
            'background_task_workers': 2,
            'cleanup_interval_minutes': 15,
            'resource_monitoring_enabled': True
        }
    
    def _generate_monitoring_config(self) -> Dict[str, Any]:
        """Генерує конфігурацію моніторингу"""
        return {
            'metrics_enabled': True,
            'log_level': 'INFO',
            'performance_tracking': True,
            'error_alerting': True,
            'usage_analytics': True,
            'retention_days': 30
        }
    
    def validate_config(self, config: Dict[str, Any]) -> bool:
        """Валідує конфігурацію"""
        required_sections = ['adaptive_limits', 'caching_strategy', 'resource_allocation', 'monitoring']
        return all(section in config for section in required_sections)

class IntelligentConfigManager:
    """Головний менеджер інтелектуальної конфігурації"""
    
    def __init__(self, config_dir: Path = None):
        self.config_dir = config_dir or Path(__file__).parent
        self.strategies = []
        self.parameters = {}
        self.context_cache = {}
        
        # Ініціалізуємо стандартні стратегії
        self._initialize_strategies()
    
    def _initialize_strategies(self):
        """Ініціалізує стратегії конфігурації"""
        self.strategies = [
            ResourceAwareStrategy(),
            UsagePatternStrategy()
        ]
    
    def add_strategy(self, strategy: ConfigurationStrategy):
        """Додає нову стратегію"""
        self.strategies.append(strategy)
    
    def register_parameter(self, param: IntelligentParameter):
        """Реєструє інтелектуальний параметр"""
        self.parameters[param.name] = param
    
    def generate_complete_config(self, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Генерує повну конфігурацію"""
        if context is None:
            context = self._build_context()
        
        # Збираємо конфігурацію з усіх стратегій
        complete_config = {}
        
        for strategy in self.strategies:
            try:
                strategy_config = strategy.generate_config(context)
                if strategy.validate_config(strategy_config):
                    complete_config.update(strategy_config)
                else:
                    logger.warning(f"Strategy {strategy.__class__.__name__} generated invalid config")
            except Exception as e:
                logger.error(f"Strategy {strategy.__class__.__name__} failed: {e}")
        
        # Застосовуємо адаптацію параметрів
        for param_name, param in self.parameters.items():
            if param_name in complete_config:
                complete_config[param_name] = param.adapt_value(context)
        
        # Додаємо метаінформацію
        complete_config['meta'] = {
            'generated_at': time.time(),
            'context_hash': self._hash_context(context),
            'strategies_used': [s.__class__.__name__ for s in self.strategies],
            'adaptive_parameters': list(self.parameters.keys())
        }
        
        return complete_config
    
    def _build_context(self) -> Dict[str, Any]:
        """Будує контекст для генерації конфігурації"""
        import datetime
        
        context = {
            'timestamp': time.time(),
            'current_hour': datetime.datetime.now().hour,
            'environment': os.environ.copy(),
            'working_directory': str(Path.cwd()),
            'process_id': os.getpid()
        }
        
        # Додаємо системну інформацію якщо доступна
        try:
            import psutil
            context['system_resources'] = {
                'cpu_percent': psutil.cpu_percent(interval=1),
                'memory': psutil.virtual_memory()._asdict(),
                'disk_usage': psutil.disk_usage('/')._asdict(),
                'network_io': psutil.net_io_counters()._asdict()
            }
        except ImportError:
            logger.warning("psutil not available, system resources will not be included")
        
        return context
    
    def _hash_context(self, context: Dict[str, Any]) -> str:
        """Створює хеш контексту для кешування"""
        import hashlib
        
        # Видаляємо змінні поля для стабільного хешування
        stable_context = context.copy()
        stable_context.pop('timestamp', None)
        stable_context.pop('process_id', None)
        
        context_str = json.dumps(stable_context, sort_keys=True, default=str)
        return hashlib.md5(context_str.encode()).hexdigest()
    
    def save_config(self, config: Dict[str, Any], filename: str = "intelligent_config.json"):
        """Зберігає згенеровану конфігурацію"""
        config_path = self.config_dir / filename
        
        try:
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, indent=2, ensure_ascii=False, default=str)
            logger.info(f"Configuration saved to {config_path}")
        except Exception as e:
            logger.error(f"Failed to save configuration: {e}")
    
    def load_config(self, filename: str = "intelligent_config.json") -> Optional[Dict[str, Any]]:
        """Завантажує збережену конфігурацію"""
        config_path = self.config_dir / filename
        
        if not config_path.exists():
            return None
        
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load configuration: {e}")
            return None

# Приклад використання
if __name__ == "__main__":
    # Створюємо менеджер
    config_manager = IntelligentConfigManager()
    
    # Реєструємо інтелектуальні параметри
    config_manager.register_parameter(
        IntelligentParameter(
            name="max_context_tokens",
            value=45000,
            constraints={"min": 1000, "max": 100000}
        )
    )
    
    # Генеруємо конфігурацію
    intelligent_config = config_manager.generate_complete_config()
    
    # Зберігаємо
    config_manager.save_config(intelligent_config)
    
    print("Intelligent configuration generated successfully!")
    print(json.dumps(intelligent_config, indent=2, default=str))
