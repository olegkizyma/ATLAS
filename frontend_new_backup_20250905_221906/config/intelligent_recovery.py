#!/usr/bin/env python3
"""
ATLAS Intelligent Recovery System
Система інтелектуальної обробки недовиконання та відновлення
"""

import json
import time
import logging
import asyncio
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from intelligent_config import IntelligentConfigManager

logger = logging.getLogger('atlas.intelligent_recovery')

class FailureType(Enum):
    """Типи невдач"""
    PARTIAL_COMPLETION = "partial_completion"
    TIMEOUT = "timeout"
    API_ERROR = "api_error"
    RESOURCE_UNAVAILABLE = "resource_unavailable"
    POLICY_VIOLATION = "policy_violation"
    CONTEXT_OVERFLOW = "context_overflow"
    DEPENDENCY_FAILURE = "dependency_failure"
    UNKNOWN = "unknown"

class RecoveryStrategy(Enum):
    """Стратегії відновлення"""
    RETRY_WITH_BACKOFF = "retry_with_backoff"
    ALTERNATIVE_APPROACH = "alternative_approach"
    DECOMPOSE_TASK = "decompose_task"
    FALLBACK_AGENT = "fallback_agent"
    CONTEXT_REDUCTION = "context_reduction"
    MANUAL_INTERVENTION = "manual_intervention"
    ADAPTIVE_LEARNING = "adaptive_learning"

@dataclass
class FailureContext:
    """Контекст невдачі"""
    failure_type: FailureType
    error_message: str
    timestamp: float
    agent_name: str
    task_spec: Dict[str, Any]
    execution_context: Dict[str, Any]
    previous_attempts: int = 0
    recovery_hints: List[str] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)

@dataclass
class RecoveryPlan:
    """План відновлення"""
    strategy: RecoveryStrategy
    steps: List[str]
    estimated_success_rate: float
    resource_requirements: Dict[str, Any]
    fallback_plan: Optional['RecoveryPlan'] = None
    adaptation_parameters: Dict[str, Any] = field(default_factory=dict)

class IntelligentFailureAnalyzer:
    """Інтелектуальний аналізатор невдач"""
    
    def __init__(self):
        self.failure_patterns = self._load_failure_patterns()
        self.success_patterns = self._load_success_patterns()
        
    def _load_failure_patterns(self) -> Dict[str, Any]:
        """Завантажує патерни невдач"""
        return {
            "timeout_patterns": [
                "timeout", "timed out", "connection timeout", "request timeout",
                "час вичерпано", "таймаут", "перевищено час"
            ],
            "api_error_patterns": [
                "api error", "http 4", "http 5", "rate limit", "quota exceeded",
                "помилка api", "ліміт запитів", "квота вичерпана"
            ],
            "resource_patterns": [
                "resource not found", "service unavailable", "connection refused",
                "ресурс недоступний", "сервіс недоступний"
            ],
            "context_overflow_patterns": [
                "token limit", "context too long", "prompt too large",
                "ліміт токенів", "контекст занадто довгий"
            ],
            "policy_patterns": [
                "policy violation", "blocked", "forbidden", "unsafe",
                "порушення політики", "заблоковано", "небезпечно"
            ]
        }
    
    def _load_success_patterns(self) -> Dict[str, Any]:
        """Завантажує патерни успішного виконання"""
        return {
            "completion_indicators": [
                "completed", "finished", "done", "success", "завершено", "готово", "успішно"
            ],
            "progress_indicators": [
                "processing", "working", "executing", "обробка", "виконання"
            ],
            "quality_indicators": [
                "verified", "validated", "confirmed", "перевірено", "підтверджено"
            ]
        }
    
    def analyze_failure(self, execution_result: Dict[str, Any], context: Dict[str, Any]) -> FailureContext:
        """Аналізує невдачу та створює контекст"""
        
        error_message = execution_result.get('error_message', '')
        agent_name = execution_result.get('agent_name', 'unknown')
        
        # Визначаємо тип невдачі
        failure_type = self._classify_failure(error_message, execution_result)
        
        # Генеруємо підказки для відновлення
        recovery_hints = self._generate_recovery_hints(failure_type, error_message, context)
        
        return FailureContext(
            failure_type=failure_type,
            error_message=error_message,
            timestamp=time.time(),
            agent_name=agent_name,
            task_spec=context.get('task_spec', {}),
            execution_context=context,
            previous_attempts=execution_result.get('attempt_count', 0),
            recovery_hints=recovery_hints,
            metadata=execution_result.get('metadata', {})
        )
    
    def _classify_failure(self, error_message: str, result: Dict[str, Any]) -> FailureType:
        """Класифікує тип невдачі"""
        message_lower = error_message.lower()
        
        # Перевіряємо патерни
        for pattern_type, patterns in self.failure_patterns.items():
            if any(pattern in message_lower for pattern in patterns):
                if pattern_type == "timeout_patterns":
                    return FailureType.TIMEOUT
                elif pattern_type == "api_error_patterns":
                    return FailureType.API_ERROR
                elif pattern_type == "resource_patterns":
                    return FailureType.RESOURCE_UNAVAILABLE
                elif pattern_type == "context_overflow_patterns":
                    return FailureType.CONTEXT_OVERFLOW
                elif pattern_type == "policy_patterns":
                    return FailureType.POLICY_VIOLATION
        
        # Перевіряємо часткове виконання
        if result.get('partial_success', False) or 'partial' in message_lower:
            return FailureType.PARTIAL_COMPLETION
        
        return FailureType.UNKNOWN
    
    def _generate_recovery_hints(self, failure_type: FailureType, error_message: str, context: Dict[str, Any]) -> List[str]:
        """Генерує підказки для відновлення"""
        hints = []
        
        if failure_type == FailureType.TIMEOUT:
            hints.extend([
                "Збільшити timeout для запитів",
                "Розбити задачу на менші частини",
                "Використати асинхронне виконання"
            ])
        
        elif failure_type == FailureType.API_ERROR:
            hints.extend([
                "Перевірити статус API ключів",
                "Використати exponential backoff",
                "Переключитися на резервний API"
            ])
        
        elif failure_type == FailureType.CONTEXT_OVERFLOW:
            hints.extend([
                "Скоротити контекст запиту",
                "Використати context summarization",
                "Розбити на менші промпти"
            ])
        
        elif failure_type == FailureType.PARTIAL_COMPLETION:
            hints.extend([
                "Продовжити з останнього успішного кроку",
                "Перевірити які частини виконані",
                "Доповнити відсутні елементи"
            ])
        
        elif failure_type == FailureType.POLICY_VIOLATION:
            hints.extend([
                "Перефразувати запит",
                "Використати test mode",
                "Додати контекст безпеки"
            ])
        
        return hints

class IntelligentRecoveryPlanner:
    """Інтелектуальний планувальник відновлення"""
    
    def __init__(self):
        self.config_manager = IntelligentConfigManager()
        self.strategy_effectiveness = self._load_strategy_metrics()
    
    def _load_strategy_metrics(self) -> Dict[RecoveryStrategy, float]:
        """Завантажує метрики ефективності стратегій"""
        return {
            RecoveryStrategy.RETRY_WITH_BACKOFF: 0.7,
            RecoveryStrategy.ALTERNATIVE_APPROACH: 0.8,
            RecoveryStrategy.DECOMPOSE_TASK: 0.85,
            RecoveryStrategy.FALLBACK_AGENT: 0.6,
            RecoveryStrategy.CONTEXT_REDUCTION: 0.75,
            RecoveryStrategy.ADAPTIVE_LEARNING: 0.9,
            RecoveryStrategy.MANUAL_INTERVENTION: 0.95
        }
    
    def create_recovery_plan(self, failure_context: FailureContext) -> RecoveryPlan:
        """Створює план відновлення"""
        
        # Вибираємо основну стратегію
        primary_strategy = self._select_primary_strategy(failure_context)
        
        # Генеруємо кроки
        steps = self._generate_recovery_steps(primary_strategy, failure_context)
        
        # Оцінюємо шанси на успіх
        success_rate = self._estimate_success_rate(primary_strategy, failure_context)
        
        # Визначаємо ресурси
        resources = self._calculate_resource_requirements(primary_strategy, failure_context)
        
        # Створюємо fallback план
        fallback_plan = self._create_fallback_plan(failure_context) if success_rate < 0.8 else None
        
        # Адаптаційні параметри
        adaptation_params = self._generate_adaptation_parameters(failure_context)
        
        return RecoveryPlan(
            strategy=primary_strategy,
            steps=steps,
            estimated_success_rate=success_rate,
            resource_requirements=resources,
            fallback_plan=fallback_plan,
            adaptation_parameters=adaptation_params
        )
    
    def _select_primary_strategy(self, failure_context: FailureContext) -> RecoveryStrategy:
        """Вибирає основну стратегію відновлення"""
        
        failure_type = failure_context.failure_type
        attempts = failure_context.previous_attempts
        
        # Логіка вибору стратегії базуючись на типі невдачі
        if failure_type == FailureType.TIMEOUT and attempts < 3:
            return RecoveryStrategy.RETRY_WITH_BACKOFF
        
        elif failure_type == FailureType.API_ERROR:
            return RecoveryStrategy.FALLBACK_AGENT
        
        elif failure_type == FailureType.CONTEXT_OVERFLOW:
            return RecoveryStrategy.CONTEXT_REDUCTION
        
        elif failure_type == FailureType.PARTIAL_COMPLETION:
            return RecoveryStrategy.ALTERNATIVE_APPROACH
        
        elif failure_type == FailureType.POLICY_VIOLATION:
            return RecoveryStrategy.ADAPTIVE_LEARNING
        
        elif attempts >= 3:
            return RecoveryStrategy.DECOMPOSE_TASK
        
        return RecoveryStrategy.ALTERNATIVE_APPROACH
    
    def _generate_recovery_steps(self, strategy: RecoveryStrategy, failure_context: FailureContext) -> List[str]:
        """Генерує кроки відновлення"""
        
        base_steps = []
        
        if strategy == RecoveryStrategy.RETRY_WITH_BACKOFF:
            base_steps = [
                f"Очікування {2 ** failure_context.previous_attempts} секунд",
                "Повторна спроба виконання задачі",
                "Моніторинг прогресу виконання"
            ]
        
        elif strategy == RecoveryStrategy.ALTERNATIVE_APPROACH:
            base_steps = [
                "Аналіз альтернативних підходів",
                "Вибір найбільш підходящого методу",
                "Адаптація параметрів виконання",
                "Виконання альтернативним способом"
            ]
        
        elif strategy == RecoveryStrategy.DECOMPOSE_TASK:
            base_steps = [
                "Розбиття задачі на менші підзадачі",
                "Пріоритизація підзадач",
                "Послідовне виконання підзадач",
                "Збірка результатів"
            ]
        
        elif strategy == RecoveryStrategy.CONTEXT_REDUCTION:
            base_steps = [
                "Аналіз розміру контексту",
                "Компресія найменш важливих частин",
                "Збереження критичної інформації",
                "Повторне виконання з скороченим контекстом"
            ]
        
        elif strategy == RecoveryStrategy.FALLBACK_AGENT:
            base_steps = [
                "Вибір резервного агента",
                "Адаптація задачі під можливості агента",
                "Переключення на резервного агента",
                "Виконання з новим агентом"
            ]
        
        elif strategy == RecoveryStrategy.ADAPTIVE_LEARNING:
            base_steps = [
                "Аналіз патерну невдачі",
                "Навчання на помилці",
                "Адаптація поведінки системи",
                "Повторне виконання з адаптованими параметрами"
            ]
        
        # Додаємо специфічні кроки базуючись на контексті
        if failure_context.recovery_hints:
            base_steps.extend([f"Застосування підказки: {hint}" for hint in failure_context.recovery_hints[:2]])
        
        return base_steps
    
    def _estimate_success_rate(self, strategy: RecoveryStrategy, failure_context: FailureContext) -> float:
        """Оцінює шанси на успіх"""
        base_rate = self.strategy_effectiveness.get(strategy, 0.5)
        
        # Корегуємо базуючись на кількості спроб
        attempt_penalty = 0.1 * failure_context.previous_attempts
        
        # Корегуємо базуючись на типі невдачі
        failure_type_bonus = {
            FailureType.TIMEOUT: 0.1 if strategy == RecoveryStrategy.RETRY_WITH_BACKOFF else -0.1,
            FailureType.CONTEXT_OVERFLOW: 0.2 if strategy == RecoveryStrategy.CONTEXT_REDUCTION else -0.1,
            FailureType.PARTIAL_COMPLETION: 0.15 if strategy == RecoveryStrategy.ALTERNATIVE_APPROACH else 0,
        }.get(failure_context.failure_type, 0)
        
        return max(0.1, min(0.95, base_rate - attempt_penalty + failure_type_bonus))
    
    def _calculate_resource_requirements(self, strategy: RecoveryStrategy, failure_context: FailureContext) -> Dict[str, Any]:
        """Обчислює потреби в ресурсах"""
        
        base_resources = {
            'time_estimate_seconds': 30,
            'api_calls_estimate': 1,
            'memory_usage_mb': 10,
            'requires_user_interaction': False
        }
        
        if strategy == RecoveryStrategy.RETRY_WITH_BACKOFF:
            base_resources['time_estimate_seconds'] = 60 * (2 ** failure_context.previous_attempts)
            
        elif strategy == RecoveryStrategy.DECOMPOSE_TASK:
            base_resources['api_calls_estimate'] = 5
            base_resources['time_estimate_seconds'] = 120
            
        elif strategy == RecoveryStrategy.MANUAL_INTERVENTION:
            base_resources['requires_user_interaction'] = True
            base_resources['time_estimate_seconds'] = 300
        
        return base_resources
    
    def _create_fallback_plan(self, failure_context: FailureContext) -> RecoveryPlan:
        """Створює резервний план"""
        # Простий резервний план - ручне втручання
        return RecoveryPlan(
            strategy=RecoveryStrategy.MANUAL_INTERVENTION,
            steps=[
                "Сповіщення користувача про неможливість автоматичного відновлення",
                "Збереження контексту для ручного аналізу",
                "Очікування ручного втручання"
            ],
            estimated_success_rate=0.95,
            resource_requirements={
                'requires_user_interaction': True,
                'time_estimate_seconds': 600
            }
        )
    
    def _generate_adaptation_parameters(self, failure_context: FailureContext) -> Dict[str, Any]:
        """Генерує параметри адаптації"""
        return {
            'increase_timeout_factor': 1.5 if failure_context.failure_type == FailureType.TIMEOUT else 1.0,
            'reduce_context_factor': 0.7 if failure_context.failure_type == FailureType.CONTEXT_OVERFLOW else 1.0,
            'use_conservative_mode': failure_context.failure_type == FailureType.POLICY_VIOLATION,
            'enable_detailed_logging': True,
            'max_retry_attempts': max(1, 5 - failure_context.previous_attempts)
        }

class IntelligentRecoveryExecutor:
    """Інтелектуальний виконавець відновлення"""
    
    def __init__(self, orchestrator_callback: Optional[callable] = None):
        self.orchestrator_callback = orchestrator_callback
        self.recovery_history = []
    
    async def execute_recovery(self, recovery_plan: RecoveryPlan, failure_context: FailureContext) -> Dict[str, Any]:
        """Виконує план відновлення"""
        
        start_time = time.time()
        
        try:
            # Логуємо початок відновлення
            logger.info(f"Starting recovery with strategy: {recovery_plan.strategy.value}")
            
            # Виконуємо кроки відновлення
            step_results = []
            for i, step in enumerate(recovery_plan.steps):
                step_result = await self._execute_recovery_step(
                    step, recovery_plan, failure_context, i
                )
                step_results.append(step_result)
                
                if not step_result.get('success', True):
                    # Якщо крок невдалий і є fallback план
                    if recovery_plan.fallback_plan:
                        logger.info("Primary recovery failed, executing fallback plan")
                        return await self.execute_recovery(recovery_plan.fallback_plan, failure_context)
                    else:
                        break
            
            # Оцінюємо успіх відновлення
            recovery_successful = all(step.get('success', True) for step in step_results)
            
            result = {
                'success': recovery_successful,
                'strategy_used': recovery_plan.strategy.value,
                'execution_time': time.time() - start_time,
                'steps_executed': len(step_results),
                'step_results': step_results,
                'failure_context': failure_context,
                'adaptation_applied': recovery_plan.adaptation_parameters
            }
            
            # Записуємо в історію
            self.recovery_history.append(result)
            
            return result
            
        except Exception as e:
            logger.error(f"Recovery execution failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'execution_time': time.time() - start_time,
                'strategy_used': recovery_plan.strategy.value,
                'failure_context': failure_context
            }
    
    async def _execute_recovery_step(self, step: str, plan: RecoveryPlan, context: FailureContext, step_index: int) -> Dict[str, Any]:
        """Виконує окремий крок відновлення"""
        
        step_start = time.time()
        
        try:
            # Симуляція виконання кроку (в реальній імплементації тут були б специфічні дії)
            if "Очікування" in step:
                wait_time = int([s for s in step.split() if s.isdigit()][0]) if any(s.isdigit() for s in step.split()) else 1
                await asyncio.sleep(min(wait_time, 10))  # Обмежуємо максимальний час очікування
            
            elif "Повторна спроба" in step or "Виконання" in step:
                if self.orchestrator_callback:
                    # Викликаємо оркестратор для повторного виконання
                    result = await self.orchestrator_callback(
                        context.task_spec, 
                        context.execution_context,
                        plan.adaptation_parameters
                    )
                    return {
                        'success': result.get('success', False),
                        'step': step,
                        'execution_time': time.time() - step_start,
                        'details': result
                    }
            
            # Для всіх інших кроків повертаємо успішний результат
            return {
                'success': True,
                'step': step,
                'execution_time': time.time() - step_start,
                'details': f"Step '{step}' completed successfully"
            }
            
        except Exception as e:
            return {
                'success': False,
                'step': step,
                'execution_time': time.time() - step_start,
                'error': str(e)
            }

class IntelligentRecoverySystem:
    """Повна система інтелектуального відновлення"""
    
    def __init__(self, orchestrator_callback: Optional[callable] = None):
        self.failure_analyzer = IntelligentFailureAnalyzer()
        self.recovery_planner = IntelligentRecoveryPlanner()
        self.recovery_executor = IntelligentRecoveryExecutor(orchestrator_callback)
        
        # Статистика системи
        self.recovery_stats = {
            'total_failures': 0,
            'successful_recoveries': 0,
            'failed_recoveries': 0,
            'strategy_usage': {},
            'most_common_failures': {}
        }
    
    async def handle_failure(self, execution_result: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Основний метод обробки невдач"""
        
        self.recovery_stats['total_failures'] += 1
        
        # Аналізуємо невдачу
        failure_context = self.failure_analyzer.analyze_failure(execution_result, context)
        
        # Оновлюємо статистику
        failure_type_str = failure_context.failure_type.value
        self.recovery_stats['most_common_failures'][failure_type_str] = \
            self.recovery_stats['most_common_failures'].get(failure_type_str, 0) + 1
        
        # Створюємо план відновлення
        recovery_plan = self.recovery_planner.create_recovery_plan(failure_context)
        
        # Оновлюємо статистику стратегій
        strategy_str = recovery_plan.strategy.value
        self.recovery_stats['strategy_usage'][strategy_str] = \
            self.recovery_stats['strategy_usage'].get(strategy_str, 0) + 1
        
        # Виконуємо відновлення
        recovery_result = await self.recovery_executor.execute_recovery(recovery_plan, failure_context)
        
        # Оновлюємо статистику результатів
        if recovery_result['success']:
            self.recovery_stats['successful_recoveries'] += 1
        else:
            self.recovery_stats['failed_recoveries'] += 1
        
        return {
            'recovery_attempted': True,
            'recovery_successful': recovery_result['success'],
            'failure_analysis': failure_context,
            'recovery_plan': recovery_plan,
            'recovery_result': recovery_result,
            'system_stats': self.recovery_stats.copy()
        }
    
    def get_system_health_report(self) -> Dict[str, Any]:
        """Генерує звіт про стан системи"""
        
        total_attempts = self.recovery_stats['total_failures']
        success_rate = (self.recovery_stats['successful_recoveries'] / total_attempts * 100) if total_attempts > 0 else 0
        
        return {
            'recovery_success_rate': round(success_rate, 2),
            'total_recovery_attempts': total_attempts,
            'most_effective_strategy': max(self.recovery_stats['strategy_usage'].items(), key=lambda x: x[1]) if self.recovery_stats['strategy_usage'] else None,
            'most_common_failure_type': max(self.recovery_stats['most_common_failures'].items(), key=lambda x: x[1]) if self.recovery_stats['most_common_failures'] else None,
            'system_learning_enabled': True,
            'adaptive_improvements': len(self.recovery_executor.recovery_history)
        }

# Приклад використання
if __name__ == "__main__":
    async def test_recovery_system():
        # Симуляція callback оркестратора
        async def mock_orchestrator_callback(task_spec, context, adaptations):
            # Симулюємо 70% успішність
            import random
            return {'success': random.random() > 0.3}
        
        # Створюємо систему відновлення
        recovery_system = IntelligentRecoverySystem(mock_orchestrator_callback)
        
        # Симулюємо невдачу
        failed_execution = {
            'error_message': 'Connection timeout after 30 seconds',
            'agent_name': 'Tetiana',
            'attempt_count': 1,
            'partial_success': False
        }
        
        context = {
            'task_spec': {
                'title': 'Знайти M1 TV кліпи',
                'summary': 'Пошук популярних кліпів через браузер'
            },
            'user_request': 'Знайди популярні кліпи M1 TV'
        }
        
        # Обробляємо невдачу
        result = await recovery_system.handle_failure(failed_execution, context)
        
        print("=== РЕЗУЛЬТАТ ОБРОБКИ НЕВДАЧІ ===")
        print(json.dumps(result, indent=2, default=str, ensure_ascii=False))
        
        print("\n=== ЗВІТ ПРО СТАН СИСТЕМИ ===")
        health_report = recovery_system.get_system_health_report()
        print(json.dumps(health_report, indent=2, default=str, ensure_ascii=False))
    
    asyncio.run(test_recovery_system())
