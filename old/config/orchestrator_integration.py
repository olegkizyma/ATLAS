#!/usr/bin/env python3
"""
ATLAS Orchestrator Integration with Intelligent Recovery
Інтеграція оркестратора з інтелектуальною системою відновлення
"""

import json
import asyncio
import logging
from typing import Dict, Any
from pathlib import Path
from intelligent_orchestrator import IntelligentOrchestrator
from intelligent_recovery import IntelligentRecoverySystem, FailureType

logger = logging.getLogger('atlas.orchestrator_integration')

class RecoveryIntegratedOrchestrator(IntelligentOrchestrator):
    """Оркестратор з інтегрованою системою відновлення"""
    
    def __init__(self):
        super().__init__()
        
        # Створюємо систему відновлення з callback на себе
        self.recovery_system = IntelligentRecoverySystem(
            orchestrator_callback=self._retry_execution_with_adaptations
        )
        
        # Лічильники для моніторингу
        self.execution_stats = {
            'total_requests': 0,
            'successful_executions': 0,
            'failed_executions': 0,
            'recovered_executions': 0,
            'unrecoverable_failures': 0
        }
    
    async def process_request(self, user_request: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Обробляє запит з інтелектуальним відновленням при невдачі"""
        
        if context is None:
            context = {}
        
        self.execution_stats['total_requests'] += 1
        
        try:
            # Спочатку пробуємо звичайне виконання
            result = await super().process_request(user_request, context)
            
            # Перевіряємо чи потрібно відновлення
            if not result.get('success', True) or self._is_incomplete_execution(result):
                
                logger.info(f"Execution failed or incomplete, initiating recovery")
                
                # Готуємо контекст невдачі
                execution_result = {
                    'error_message': result.get('error', 'Execution incomplete or failed'),
                    'agent_name': result.get('last_agent', 'unknown'),
                    'attempt_count': result.get('attempt_count', 1),
                    'partial_success': self._assess_partial_success(result),
                    'metadata': result
                }
                
                # Розширюємо контекст для аналізу
                recovery_context = {
                    'user_request': user_request,
                    'task_spec': result.get('plan', {}).get('task_spec', {}),
                    'execution_context': context,
                    'original_result': result
                }
                
                # Запускаємо систему відновлення
                recovery_result = await self.recovery_system.handle_failure(
                    execution_result, recovery_context
                )
                
                # Оновлюємо статистику
                if recovery_result['recovery_successful']:
                    self.execution_stats['recovered_executions'] += 1
                    self.execution_stats['successful_executions'] += 1
                else:
                    self.execution_stats['unrecoverable_failures'] += 1
                    self.execution_stats['failed_executions'] += 1
                
                # Повертаємо розширений результат
                return {
                    **result,
                    'recovery_applied': True,
                    'recovery_details': recovery_result,
                    'final_success': recovery_result['recovery_successful']
                }
            
            else:
                # Успішне виконання без потреби у відновленні
                self.execution_stats['successful_executions'] += 1
                return {
                    **result,
                    'recovery_applied': False,
                    'final_success': True
                }
        
        except Exception as e:
            logger.error(f"Critical error in orchestrator: {e}")
            self.execution_stats['failed_executions'] += 1
            
            # Навіть критичні помилки намагаємося відновити
            execution_result = {
                'error_message': str(e),
                'agent_name': 'orchestrator',
                'attempt_count': 1,
                'partial_success': False,
                'metadata': {'critical_error': True}
            }
            
            recovery_context = {
                'user_request': user_request,
                'task_spec': {},
                'execution_context': context,
                'original_error': e
            }
            
            try:
                recovery_result = await self.recovery_system.handle_failure(
                    execution_result, recovery_context
                )
                
                return {
                    'success': recovery_result['recovery_successful'],
                    'error': str(e),
                    'recovery_applied': True,
                    'recovery_details': recovery_result,
                    'final_success': recovery_result['recovery_successful']
                }
            except Exception as recovery_error:
                logger.error(f"Recovery also failed: {recovery_error}")
                self.execution_stats['unrecoverable_failures'] += 1
                
                return {
                    'success': False,
                    'error': str(e),
                    'recovery_applied': False,
                    'recovery_error': str(recovery_error),
                    'final_success': False
                }
    
    def _is_incomplete_execution(self, result: Dict[str, Any]) -> bool:
        """Визначає чи виконання неповне"""
        
        # Перевіряємо різні індикатори неповного виконання
        if not result.get('success', True):
            return True
        
        # Перевіряємо чи всі кроки виконані
        plan = result.get('plan', {})
        expected_steps = len(plan.get('steps', []))
        completed_steps = result.get('steps_completed', 0)
        
        if expected_steps > 0 and completed_steps < expected_steps:
            return True
        
        # Перевіряємо тривалість виконання (дуже швидке виконання може бути неповним)
        execution_time = result.get('execution_time', 0)
        if execution_time < 1.0 and expected_steps > 3:  # Підозріло швидко для складних задач
            return True
        
        # Перевіряємо наявність помилок в агентах
        if result.get('agent_errors', []):
            return True
        
        return False
    
    def _assess_partial_success(self, result: Dict[str, Any]) -> bool:
        """Оцінює чи було часткове виконання"""
        
        # Якщо деякі кроки виконані
        steps_completed = result.get('steps_completed', 0)
        if steps_completed > 0:
            return True
        
        # Якщо є взаємодії з агентами
        agent_interactions = result.get('agent_interactions', 0)
        if agent_interactions > 0:
            return True
        
        # Якщо є часткові результати
        if result.get('partial_results', []):
            return True
        
        return False
    
    async def _retry_execution_with_adaptations(self, task_spec: Dict[str, Any], context: Dict[str, Any], adaptations: Dict[str, Any]) -> Dict[str, Any]:
        """Callback для повторного виконання з адаптаціями"""
        
        try:
            # Застосовуємо адаптації до контексту
            adapted_context = self._apply_adaptations(context, adaptations)
            
            # Генеруємо адаптований запит
            adapted_request = self._generate_adapted_request(task_spec, adaptations)
            
            # Виконуємо з адаптованими параметрами
            result = await super().process_request(adapted_request, adapted_context)
            
            # Додаємо інформацію про адаптації
            result['adaptations_applied'] = adaptations
            result['retry_execution'] = True
            
            return result
        
        except Exception as e:
            logger.error(f"Retry execution failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'adaptations_applied': adaptations,
                'retry_execution': True
            }
    
    def _apply_adaptations(self, context: Dict[str, Any], adaptations: Dict[str, Any]) -> Dict[str, Any]:
        """Застосовує адаптації до контексту виконання"""
        
        adapted_context = context.copy()
        
        # Адаптація timeout
        if 'increase_timeout_factor' in adaptations:
            factor = adaptations['increase_timeout_factor']
            adapted_context['timeout_multiplier'] = factor
        
        # Адаптація контексту
        if 'reduce_context_factor' in adaptations:
            factor = adaptations['reduce_context_factor']
            adapted_context['context_reduction_factor'] = factor
        
        # Консервативний режим
        if adaptations.get('use_conservative_mode', False):
            adapted_context['conservative_mode'] = True
            adapted_context['safety_level'] = 'high'
        
        # Детальне логування
        if adaptations.get('enable_detailed_logging', False):
            adapted_context['detailed_logging'] = True
        
        # Обмеження спроб
        if 'max_retry_attempts' in adaptations:
            adapted_context['max_attempts'] = adaptations['max_retry_attempts']
        
        return adapted_context
    
    def _generate_adapted_request(self, task_spec: Dict[str, Any], adaptations: Dict[str, Any]) -> str:
        """Генерує адаптований запит"""
        
        base_request = task_spec.get('summary', 'Виконати задачу')
        
        # Додаємо модифікатори базуючись на адаптаціях
        modifiers = []
        
        if adaptations.get('use_conservative_mode', False):
            modifiers.append("використовуючи консервативний підхід")
        
        if adaptations.get('reduce_context_factor', 1.0) < 1.0:
            modifiers.append("з мінімальним контекстом")
        
        if adaptations.get('enable_detailed_logging', False):
            modifiers.append("з детальним звітуванням кожного кроку")
        
        if modifiers:
            return f"{base_request}, {', '.join(modifiers)}"
        
        return base_request
    
    def get_comprehensive_stats(self) -> Dict[str, Any]:
        """Отримує повну статистику системи"""
        
        # Базова статистика виконання
        total = self.execution_stats['total_requests']
        success_rate = (self.execution_stats['successful_executions'] / total * 100) if total > 0 else 0
        recovery_rate = (self.execution_stats['recovered_executions'] / self.execution_stats['failed_executions'] * 100) if self.execution_stats['failed_executions'] > 0 else 0
        
        # Статистика відновлення
        recovery_health = self.recovery_system.get_system_health_report()
        
        return {
            'orchestrator_stats': {
                'total_requests_processed': total,
                'overall_success_rate': round(success_rate, 2),
                'recovery_success_rate': round(recovery_rate, 2),
                'natural_success_rate': round((self.execution_stats['successful_executions'] - self.execution_stats['recovered_executions']) / total * 100, 2) if total > 0 else 0,
                'breakdown': self.execution_stats
            },
            'recovery_system_health': recovery_health,
            'system_resilience': {
                'failure_tolerance': round(recovery_rate, 2),
                'adaptation_capability': recovery_health.get('adaptive_improvements', 0),
                'learning_efficiency': recovery_health.get('recovery_success_rate', 0)
            }
        }

# Приклад використання інтегрованої системи
if __name__ == "__main__":
    async def test_integrated_system():
        
        # Створюємо інтегрований оркестратор
        orchestrator = RecoveryIntegratedOrchestrator()
        
        # Тестові сценарії
        test_cases = [
            {
                'name': 'Звичайний запит',
                'request': 'Знайди популярні кліпи M1 TV через Google браузер, встанови гучність 10%',
                'context': {'environment': 'test'}
            },
            {
                'name': 'Складний запит',
                'request': 'Створи детальний аналіз всіх доступних MSP серверів з повним звітом про продуктивність та рекомендаціями',
                'context': {'complexity': 'high', 'timeout': 'extended'}
            },
            {
                'name': 'Запит що може викликати timeout',
                'request': 'Виконай повний аудит безпеки системи ATLAS з перевіркою всіх компонентів',
                'context': {'thorough_check': True}
            }
        ]
        
        print("=== ТЕСТУВАННЯ ІНТЕГРОВАНОЇ СИСТЕМИ ВІДНОВЛЕННЯ ===")
        
        for i, test_case in enumerate(test_cases, 1):
            print(f"\n--- ТЕСТ {i}: {test_case['name']} ---")
            
            try:
                result = await orchestrator.process_request(
                    test_case['request'],
                    test_case['context']
                )
                
                print(f"Результат: {'✅ Успішно' if result.get('final_success') else '❌ Невдача'}")
                print(f"Відновлення застосовано: {'Так' if result.get('recovery_applied') else 'Ні'}")
                
                if result.get('recovery_applied'):
                    recovery_details = result.get('recovery_details', {})
                    print(f"Стратегія відновлення: {recovery_details.get('recovery_result', {}).get('strategy_used', 'N/A')}")
                
            except Exception as e:
                print(f"Помилка тесту: {e}")
        
        # Показуємо загальну статистику
        print("\n=== ЗАГАЛЬНА СТАТИСТИКА СИСТЕМИ ===")
        stats = orchestrator.get_comprehensive_stats()
        print(json.dumps(stats, indent=2, default=str, ensure_ascii=False))
    
    asyncio.run(test_integrated_system())
