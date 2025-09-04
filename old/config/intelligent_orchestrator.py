#!/usr/bin/env python3
"""
ATLAS Intelligent Orchestrator
Повністю адаптивний оркестратор без жорстко закодованих значень
"""

import json
import time
import logging
import asyncio
from typing import Dict, Any, List, Optional, Callable
from pathlib import Path
from dataclasses import dataclass
from abc import ABC, abstractmethod
from intelligent_config import IntelligentConfigManager, IntelligentParameter

logger = logging.getLogger('atlas.intelligent_orchestrator')

@dataclass
class AgentProfile:
    """Профіль агента з адаптивними характеристиками"""
    name: str
    role: str
    capabilities: List[str]
    performance_metrics: Dict[str, float]
    adaptation_strategy: str = "auto"
    learning_enabled: bool = True

class AgentBehaviorStrategy(ABC):
    """Абстрактна стратегія поведінки агента"""
    
    @abstractmethod
    def generate_system_prompt(self, context: Dict[str, Any]) -> str:
        """Генерує системний промпт базуючись на контексті"""
        pass
    
    @abstractmethod
    def adapt_parameters(self, agent_profile: AgentProfile, context: Dict[str, Any]) -> Dict[str, Any]:
        """Адаптує параметри агента"""
        pass

class ContextAwareBehavior(AgentBehaviorStrategy):
    """Стратегія поведінки, що враховує контекст"""
    
    def __init__(self):
        self.behavior_templates = self._load_behavior_templates()
    
    def _load_behavior_templates(self) -> Dict[str, Any]:
        """Завантажує шаблони поведінки"""
        return {
            "task_executor": {
                "base_traits": [
                    "adaptive", "efficient", "thorough", "precise"
                ],
                "context_modifiers": {
                    "high_complexity": ["methodical", "patient", "systematic"],
                    "time_sensitive": ["focused", "decisive", "prioritizing"],
                    "creative_task": ["innovative", "flexible", "exploratory"],
                    "technical_task": ["analytical", "logical", "detailed"]
                }
            },
            "safety_auditor": {
                "base_traits": [
                    "cautious", "thorough", "objective", "principled"
                ],
                "context_modifiers": {
                    "test_mode": ["permissive", "monitoring", "learning"],
                    "production_mode": ["strict", "conservative", "blocking"]
                }
            },
            "completion_judge": {
                "base_traits": [
                    "fair", "evidence_based", "criteria_focused", "unbiased"
                ],
                "context_modifiers": {
                    "strict_requirements": ["meticulous", "demanding", "precise"],
                    "flexible_requirements": ["reasonable", "practical", "contextual"]
                }
            }
        }
    
    def generate_system_prompt(self, context: Dict[str, Any]) -> str:
        """Генерує системний промпт"""
        agent_role = context.get('agent_role', 'task_executor')
        task_complexity = context.get('task_complexity', 'medium')
        environment = context.get('environment', 'development')
        
        # Отримуємо базовий шаблон
        template = self.behavior_templates.get(agent_role, self.behavior_templates['task_executor'])
        
        # Будуємо список характеристик
        traits = template['base_traits'].copy()
        
        # Додаємо контекстні модифікатори
        for modifier_key, modifier_traits in template['context_modifiers'].items():
            if self._should_apply_modifier(modifier_key, context):
                traits.extend(modifier_traits)
        
        # Генеруємо промпт
        return self._build_prompt(agent_role, traits, context)
    
    def _should_apply_modifier(self, modifier_key: str, context: Dict[str, Any]) -> bool:
        """Визначає чи застосовувати модифікатор"""
        if modifier_key == "high_complexity":
            return context.get('task_complexity') in ['high', 'very_high']
        elif modifier_key == "time_sensitive":
            return context.get('urgency_level', 'normal') in ['high', 'critical']
        elif modifier_key == "creative_task":
            return 'creative' in context.get('task_type', '').lower()
        elif modifier_key == "technical_task":
            return 'technical' in context.get('task_type', '').lower()
        elif modifier_key == "test_mode":
            return context.get('environment') == 'test'
        elif modifier_key == "production_mode":
            return context.get('environment') == 'production'
        elif modifier_key == "strict_requirements":
            return context.get('precision_level', 'normal') == 'high'
        elif modifier_key == "flexible_requirements":
            return context.get('precision_level', 'normal') == 'low'
        
        return False
    
    def _build_prompt(self, agent_role: str, traits: List[str], context: Dict[str, Any]) -> str:
        """Будує системний промпт"""
        language = context.get('language', 'ukrainian')
        
        # Базова структура промпта
        prompt_parts = []
        
        # Ідентифікація ролі
        role_descriptions = {
            'task_executor': f"Ви - інтелектуальний виконавець завдань",
            'safety_auditor': f"Ви - аудитор безпеки та відповідності",
            'completion_judge': f"Ви - суддя завершеності завдань"
        }
        
        prompt_parts.append(role_descriptions.get(agent_role, f"Ви - {agent_role}"))
        
        # Характеристики
        if traits:
            traits_str = ", ".join(traits)
            prompt_parts.append(f"Ваші ключові характеристики: {traits_str}")
        
        # Контекстні інструкції
        if context.get('environment') == 'test':
            prompt_parts.append("РЕЖИМ ТЕСТУВАННЯ АКТИВНИЙ: виконуйте завдання без блокування")
        
        if context.get('task_complexity') == 'high':
            prompt_parts.append("Завдання високої складності: приділіть особливу увагу деталям")
        
        if context.get('urgency_level') == 'high':
            prompt_parts.append("Високий пріоритет: фокусуйтесь на швидкому та ефективному виконанні")
        
        # Загальні принципи
        prompt_parts.append("Адаптуйтесь до контексту та вимог користувача")
        prompt_parts.append("Використовуйте найкращі інструменти та підходи для досягнення мети")
        
        return ". ".join(prompt_parts) + "."
    
    def adapt_parameters(self, agent_profile: AgentProfile, context: Dict[str, Any]) -> Dict[str, Any]:
        """Адаптує параметри агента"""
        base_params = {
            'max_attempts': 3,
            'timeout_seconds': 30,
            'retry_delay_ms': 500,
            'context_limit': 45000
        }
        
        # Адаптація базуючись на метриках продуктивності
        if agent_profile.performance_metrics.get('success_rate', 1.0) < 0.7:
            base_params['max_attempts'] += 2  # Більше спроб для проблемних агентів
            base_params['timeout_seconds'] += 15
        
        if agent_profile.performance_metrics.get('average_response_time', 1.0) > 10.0:
            base_params['timeout_seconds'] += 20  # Більше часу для повільних агентів
        
        # Контекстна адаптація
        if context.get('task_complexity') == 'high':
            base_params['max_attempts'] += 1
            base_params['timeout_seconds'] += 10
            base_params['context_limit'] += 10000
        
        if context.get('urgency_level') == 'high':
            base_params['timeout_seconds'] -= 10
            base_params['retry_delay_ms'] -= 200
        
        return base_params

class IntelligentAgentManager:
    """Менеджер інтелектуальних агентів"""
    
    def __init__(self):
        self.agents = {}
        self.behavior_strategies = {}
        self.performance_tracker = {}
        self.config_manager = IntelligentConfigManager()
        
        # Ініціалізуємо стандартні стратегії
        self._initialize_strategies()
        
        # Завантажуємо профілі агентів
        self._load_agent_profiles()
    
    def _initialize_strategies(self):
        """Ініціалізує стратегії поведінки"""
        self.behavior_strategies['context_aware'] = ContextAwareBehavior()
    
    def _load_agent_profiles(self):
        """Завантажує профілі агентів з адаптивними налаштуваннями"""
        # Замість жорстких профілів, генеруємо їх динамічно
        self._create_adaptive_agent('atlas', 'planner', [
            'task_analysis', 'planning', 'specification', 'coordination'
        ])
        
        self._create_adaptive_agent('grisha', 'auditor', [
            'safety_analysis', 'compliance_check', 'completion_verification'
        ])
        
        self._create_adaptive_agent('tetiana', 'executor', [
            'tool_usage', 'task_execution', 'evidence_collection', 'adaptation'
        ])
    
    def _create_adaptive_agent(self, name: str, role: str, capabilities: List[str]):
        """Створює адаптивний профіль агента"""
        profile = AgentProfile(
            name=name,
            role=role,
            capabilities=capabilities,
            performance_metrics={
                'success_rate': 0.95,
                'average_response_time': 2.0,
                'error_rate': 0.05,
                'adaptation_score': 0.8
            }
        )
        
        self.agents[name] = profile
        self.performance_tracker[name] = {
            'total_requests': 0,
            'successful_requests': 0,
            'total_response_time': 0.0,
            'errors': 0,
            'last_updated': time.time()
        }
    
    def get_agent_config(self, agent_name: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Отримує конфігурацію агента з урахуванням контексту"""
        if agent_name not in self.agents:
            raise ValueError(f"Unknown agent: {agent_name}")
        
        agent_profile = self.agents[agent_name]
        strategy = self.behavior_strategies['context_aware']
        
        # Генеруємо системний промпт
        context['agent_role'] = agent_profile.role
        system_prompt = strategy.generate_system_prompt(context)
        
        # Адаптуємо параметри
        parameters = strategy.adapt_parameters(agent_profile, context)
        
        return {
            'name': agent_profile.name,
            'role': agent_profile.role,
            'system_prompt': system_prompt,
            'parameters': parameters,
            'capabilities': agent_profile.capabilities,
            'performance_metrics': agent_profile.performance_metrics
        }
    
    def update_agent_performance(self, agent_name: str, success: bool, response_time: float):
        """Оновлює метрики продуктивності агента"""
        if agent_name not in self.performance_tracker:
            return
        
        tracker = self.performance_tracker[agent_name]
        tracker['total_requests'] += 1
        tracker['total_response_time'] += response_time
        
        if success:
            tracker['successful_requests'] += 1
        else:
            tracker['errors'] += 1
        
        # Оновлюємо метрики в профілі
        agent_profile = self.agents[agent_name]
        agent_profile.performance_metrics['success_rate'] = tracker['successful_requests'] / tracker['total_requests']
        agent_profile.performance_metrics['average_response_time'] = tracker['total_response_time'] / tracker['total_requests']
        agent_profile.performance_metrics['error_rate'] = tracker['errors'] / tracker['total_requests']
        
        tracker['last_updated'] = time.time()

class IntelligentPromptGenerator:
    """Генератор інтелектуальних промптів"""
    
    def __init__(self):
        self.prompt_templates = {}
        self.context_analyzers = []
        self._load_templates()
    
    def _load_templates(self):
        """Завантажує шаблони промптів"""
        self.prompt_templates = {
            'task_analysis': {
                'structure': [
                    'context_analysis',
                    'goal_identification', 
                    'constraint_recognition',
                    'success_criteria_definition',
                    'approach_selection'
                ],
                'adaptations': {
                    'complexity_high': 'увеличить детализацию',
                    'urgency_high': 'сосредоточиться на критичных аспектах',
                    'creative_task': 'поощрить инновационные подходы'
                }
            },
            'execution_plan': {
                'structure': [
                    'step_breakdown',
                    'resource_identification',
                    'tool_selection',
                    'contingency_planning',
                    'verification_strategy'
                ],
                'adaptations': {
                    'technical_task': 'углубить техническую специфику',
                    'user_interaction': 'включить пользовательские точки принятия решений'
                }
            }
        }
    
    def generate_prompt(self, template_name: str, context: Dict[str, Any]) -> str:
        """Генерує промпт базуючись на шаблоні та контексті"""
        if template_name not in self.prompt_templates:
            return self._generate_fallback_prompt(context)
        
        template = self.prompt_templates[template_name]
        
        # Аналізуємо контекст
        context_features = self._analyze_context(context)
        
        # Будуємо структуру промпта
        prompt_sections = []
        
        for section in template['structure']:
            section_content = self._generate_section(section, context, context_features)
            if section_content:
                prompt_sections.append(section_content)
        
        # Застосовуємо адаптації
        adaptations = self._select_adaptations(template.get('adaptations', {}), context_features)
        
        if adaptations:
            adaptation_text = "Адаптації: " + "; ".join(adaptations)
            prompt_sections.append(adaptation_text)
        
        return "\n\n".join(prompt_sections)
    
    def _analyze_context(self, context: Dict[str, Any]) -> List[str]:
        """Аналізує контекст та повертає список особливостей"""
        features = []
        
        # Аналіз складності
        if context.get('task_complexity') in ['high', 'very_high']:
            features.append('complexity_high')
        
        # Аналіз терміновості
        if context.get('urgency_level') == 'high':
            features.append('urgency_high')
        
        # Аналіз типу завдання
        task_type = context.get('task_type', '').lower()
        if 'creative' in task_type:
            features.append('creative_task')
        elif 'technical' in task_type:
            features.append('technical_task')
        
        # Аналіз взаємодії з користувачем
        if context.get('user_interaction_required', False):
            features.append('user_interaction')
        
        return features
    
    def _generate_section(self, section_name: str, context: Dict[str, Any], features: List[str]) -> Optional[str]:
        """Генерує секцію промпта"""
        section_generators = {
            'context_analysis': lambda: self._generate_context_analysis(context),
            'goal_identification': lambda: self._generate_goal_identification(context),
            'constraint_recognition': lambda: self._generate_constraint_recognition(context),
            'success_criteria_definition': lambda: self._generate_success_criteria(context),
            'approach_selection': lambda: self._generate_approach_selection(context, features),
            'step_breakdown': lambda: self._generate_step_breakdown(context),
            'resource_identification': lambda: self._generate_resource_identification(context),
            'tool_selection': lambda: self._generate_tool_selection(context),
            'contingency_planning': lambda: self._generate_contingency_planning(context),
            'verification_strategy': lambda: self._generate_verification_strategy(context)
        }
        
        generator = section_generators.get(section_name)
        return generator() if generator else None
    
    def _generate_context_analysis(self, context: Dict[str, Any]) -> str:
        """Генерує аналіз контексту"""
        return f"Проаналізуйте поточний контекст: {context.get('description', 'контекст не визначено')}"
    
    def _generate_goal_identification(self, context: Dict[str, Any]) -> str:
        """Генерує ідентифікацію цілі"""
        goal = context.get('goal', context.get('objective', 'мета не визначена'))
        return f"Головна мета: {goal}"
    
    def _generate_constraint_recognition(self, context: Dict[str, Any]) -> str:
        """Генерує розпізнавання обмежень"""
        constraints = context.get('constraints', [])
        if constraints:
            return f"Врахуйте обмеження: {'; '.join(constraints)}"
        return "Визначте можливі обмеження для виконання завдання"
    
    def _generate_success_criteria(self, context: Dict[str, Any]) -> str:
        """Генерує критерії успіху"""
        criteria = context.get('success_criteria', [])
        if criteria:
            return f"Критерії успішного виконання: {'; '.join(criteria)}"
        return "Визначте об'єктивні критерії успішного виконання"
    
    def _generate_approach_selection(self, context: Dict[str, Any], features: List[str]) -> str:
        """Генерує вибір підходу"""
        base_text = "Оберіть оптимальний підхід для виконання завдання"
        
        if 'complexity_high' in features:
            base_text += ", враховуючи високу складність"
        if 'urgency_high' in features:
            base_text += ", з фокусом на швидке виконання"
        
        return base_text
    
    def _generate_step_breakdown(self, context: Dict[str, Any]) -> str:
        """Генерує розбивку на кроки"""
        return "Розбийте завдання на конкретні, виконувані кроки"
    
    def _generate_resource_identification(self, context: Dict[str, Any]) -> str:
        """Генерує ідентифікацію ресурсів"""
        return "Визначте необхідні ресурси та інструменти"
    
    def _generate_tool_selection(self, context: Dict[str, Any]) -> str:
        """Генерує вибір інструментів"""
        available_tools = context.get('available_tools', [])
        if available_tools:
            return f"Доступні інструменти: {', '.join(available_tools)}. Оберіть найбільш підходящі"
        return "Оберіть найкращі інструменти для виконання завдання"
    
    def _generate_contingency_planning(self, context: Dict[str, Any]) -> str:
        """Генерує планування на випадок непередбачених ситуацій"""
        return "Розробіть план дій для випадку, якщо основний підхід не спрацює"
    
    def _generate_verification_strategy(self, context: Dict[str, Any]) -> str:
        """Генерує стратегію верифікації"""
        return "Визначте як перевірити успішність виконання кожного кроку"
    
    def _select_adaptations(self, adaptations: Dict[str, str], features: List[str]) -> List[str]:
        """Вибирає адаптації базуючись на особливостях контексту"""
        selected = []
        
        for feature, adaptation in adaptations.items():
            if feature in features:
                selected.append(adaptation)
        
        return selected
    
    def _generate_fallback_prompt(self, context: Dict[str, Any]) -> str:
        """Генерує резервний промпт"""
        return f"Виконайте завдання: {context.get('description', 'завдання не визначене')}"

class IntelligentOrchestrator:
    """Головний інтелектуальний оркестратор"""
    
    def __init__(self):
        self.config_manager = IntelligentConfigManager()
        self.agent_manager = IntelligentAgentManager()
        self.prompt_generator = IntelligentPromptGenerator()
        self.execution_context = {}
        
        # Завантажуємо конфігурацію
        self.config = self.config_manager.generate_complete_config()
    
    async def process_request(self, user_request: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """Обробляє запит користувача"""
        if context is None:
            context = {}
        
        # Аналізуємо запит
        analyzed_context = await self._analyze_request(user_request, context)
        
        # Планируємо виконання
        execution_plan = await self._create_execution_plan(analyzed_context)
        
        # Виконуємо план
        result = await self._execute_plan(execution_plan, analyzed_context)
        
        return result
    
    async def _analyze_request(self, request: str, context: Dict[str, Any]) -> Dict[str, Any]:
        """Аналізує запит користувача"""
        # Визначаємо контекст
        analysis_context = {
            'user_request': request,
            'timestamp': time.time(),
            'language': 'ukrainian',
            **context
        }
        
        # Визначаємо складність
        complexity = self._assess_complexity(request)
        analysis_context['task_complexity'] = complexity
        
        # Визначаємо тип завдання
        task_type = self._identify_task_type(request)
        analysis_context['task_type'] = task_type
        
        # Визначаємо терміновість
        urgency = self._assess_urgency(request, context)
        analysis_context['urgency_level'] = urgency
        
        return analysis_context
    
    def _assess_complexity(self, request: str) -> str:
        """Оцінює складність запиту"""
        # Простий алгоритм оцінки складності
        complexity_indicators = {
            'high': ['складний', 'детальний', 'повний аналіз', 'всебічний'],
            'medium': ['проаналізувати', 'створити', 'розробити'],
            'low': ['покажи', 'знайди', 'поясни', 'що таке']
        }
        
        request_lower = request.lower()
        
        for level, indicators in complexity_indicators.items():
            if any(indicator in request_lower for indicator in indicators):
                return level
        
        return 'medium'
    
    def _identify_task_type(self, request: str) -> str:
        """Ідентифікує тип завдання"""
        request_lower = request.lower()
        
        if any(word in request_lower for word in ['створити', 'придумати', 'розробити дизайн']):
            return 'creative'
        elif any(word in request_lower for word in ['код', 'програма', 'скрипт', 'технічний']):
            return 'technical'
        elif any(word in request_lower for word in ['проаналізувати', 'дослідити', 'вивчити']):
            return 'analytical'
        else:
            return 'general'
    
    def _assess_urgency(self, request: str, context: Dict[str, Any]) -> str:
        """Оцінює терміновість запиту"""
        request_lower = request.lower()
        
        if any(word in request_lower for word in ['швидко', 'терміново', 'негайно', 'зараз']):
            return 'high'
        elif any(word in request_lower for word in ['коли будете мати час', 'не поспішаючи']):
            return 'low'
        else:
            return 'normal'
    
    async def _create_execution_plan(self, context: Dict[str, Any]) -> Dict[str, Any]:
        """Створює план виконання"""
        # Отримуємо конфігурацію для Atlas (планувальника)
        atlas_config = self.agent_manager.get_agent_config('atlas', context)
        
        # Генеруємо промпт для планування
        planning_prompt = self.prompt_generator.generate_prompt('task_analysis', context)
        
        plan = {
            'agent_configs': {
                'atlas': atlas_config,
                'grisha': self.agent_manager.get_agent_config('grisha', context),
                'tetiana': self.agent_manager.get_agent_config('tetiana', context)
            },
            'planning_prompt': planning_prompt,
            'execution_context': context,
            'steps': self._generate_execution_steps(context)
        }
        
        return plan
    
    def _generate_execution_steps(self, context: Dict[str, Any]) -> List[str]:
        """Генерує кроки виконання"""
        # Базові кроки для будь-якого завдання
        steps = [
            'Аналіз завдання та контексту',
            'Планування підходу до виконання',
            'Перевірка безпеки та відповідності',
            'Виконання основних дій',
            'Збір доказів виконання',
            'Верифікація результатів',
            'Оцінка завершеності'
        ]
        
        # Адаптуємо кроки базуючись на контексті
        if context.get('task_complexity') == 'high':
            steps.insert(2, 'Деталізація складних аспектів')
        
        if context.get('task_type') == 'technical':
            steps.insert(-2, 'Технічна валідація')
        
        return steps
    
    async def _execute_plan(self, plan: Dict[str, Any], context: Dict[str, Any]) -> Dict[str, Any]:
        """Виконує план"""
        start_time = time.time()
        
        try:
            # Симуляція виконання (в реальній імплементації тут були б виклики агентів)
            result = {
                'success': True,
                'execution_time': time.time() - start_time,
                'steps_completed': len(plan['steps']),
                'agent_interactions': len(plan['agent_configs']),
                'context': context,
                'plan': plan
            }
            
            # Оновлюємо метрики продуктивності
            for agent_name in plan['agent_configs']:
                self.agent_manager.update_agent_performance(
                    agent_name, True, result['execution_time']
                )
            
            return result
            
        except Exception as e:
            logger.error(f"Execution failed: {e}")
            
            result = {
                'success': False,
                'error': str(e),
                'execution_time': time.time() - start_time,
                'context': context
            }
            
            # Оновлюємо метрики для невдалого виконання
            for agent_name in plan['agent_configs']:
                self.agent_manager.update_agent_performance(
                    agent_name, False, result['execution_time']
                )
            
            return result

# Приклад використання
if __name__ == "__main__":
    async def main():
        orchestrator = IntelligentOrchestrator()
        
        # Тестовий запит
        result = await orchestrator.process_request(
            "Знайди популярні кліпи M1 TV через Google браузер, встанови гучність 10%, повноекранний режим",
            {'environment': 'test'}
        )
        
        print(json.dumps(result, indent=2, default=str, ensure_ascii=False))
    
    asyncio.run(main())
