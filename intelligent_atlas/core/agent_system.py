#!/usr/bin/env python3
"""
ATLAS Agent System
Система 3 агентів: Atlas (планувальник), Tetyana (виконавець), Grisha (валідатор)
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional
from dataclasses import dataclass
import aiohttp

logger = logging.getLogger('atlas.agent_system')

@dataclass
class AgentResponse:
    """Відповідь агента"""
    agent_name: str
    response_text: str
    execution_evidence: Dict[str, Any]
    execution_time: float
    success: bool
    needs_continuation: bool = False

class AgentSystem:
    """Система управління агентами Atlas, Tetyana, Grisha"""
    
    def __init__(self, config: Dict[str, Any], ai_api_base: str, goose_executor):
        self.config = config
        self.ai_api_base = ai_api_base
        self.goose_executor = goose_executor
        
        # Конфігурація агентів
        self.agents = {
            'atlas': {
                'role': 'planner',
                'description': 'Стратег та планувальник, створює детальні плани виконання',
                'capabilities': ['planning', 'analysis', 'strategy', 'coordination'],
                'uses_goose': False,  # Atlas використовує тільки AI API
                'timeout': config.get('atlas', {}).get('timeout_seconds', 15)
            },
            'tetyana': {
                'role': 'executor', 
                'description': 'Виконавець завдань з доступом до інструментів системи',
                'capabilities': ['execution', 'tools', 'files', 'applications', 'verification'],
                'uses_goose': True,   # Tetyana обов'язково використовує Goose
                'timeout': config.get('tetyana', {}).get('timeout_seconds', 60)
            },
            'grisha': {
                'role': 'validator',
                'description': 'Валідатор та перевіряючий результатів виконання',
                'capabilities': ['validation', 'verification', 'quality_check', 'compliance'],
                'uses_goose': True,   # Grisha може використовувати Goose для перевірки
                'timeout': config.get('grisha', {}).get('timeout_seconds', 20)
            }
        }
        
        # Статистика роботи агентів
        self.agent_stats = {
            agent: {
                'total_requests': 0,
                'successful_requests': 0,
                'failed_requests': 0,
                'average_response_time': 0,
                'last_used': 0
            }
            for agent in self.agents.keys()
        }
    
    async def initialize(self) -> bool:
        """Ініціалізує систему агентів"""
        logger.info("🎭 Initializing Agent System...")
        
        try:
            # Перевіряємо доступність AI API
            test_response = await self._call_ai_api("test", "system_test")
            if not test_response:
                raise Exception("AI API not available")
            
            # Перевіряємо Goose для агентів що його потребують
            if self.goose_executor and not await self.goose_executor.health_check():
                logger.warning("⚠️ Goose not available - Tetyana and Grisha capabilities limited")
            
            logger.info("✅ Agent System initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Agent System: {e}")
            return False
    
    async def execute_with_agent(self, agent_name: str, request, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Виконує завдання через вказаного агента"""
        
        if agent_name not in self.agents:
            raise ValueError(f"Unknown agent: {agent_name}")
        
        start_time = time.time()
        agent_config = self.agents[agent_name]
        
        logger.info(f"🎭 Executing with agent {agent_name} ({agent_config['role']})...")
        
        try:
            self.agent_stats[agent_name]['total_requests'] += 1
            
            if agent_config['uses_goose'] and agent_name == 'tetyana':
                # Tetyana виконує через Goose (реальне виконання)
                result = await self._execute_via_goose(agent_name, request, analysis)
            elif agent_config['uses_goose'] and agent_name == 'grisha' and analysis.get('needs_verification'):
                # Grisha використовує Goose для перевірки результатів
                result = await self._execute_via_goose(agent_name, request, analysis)
            else:
                # Atlas та Grisha (без верифікації) використовують AI API
                result = await self._execute_via_ai_api(agent_name, request, analysis)
            
            execution_time = time.time() - start_time
            
            if result.get('success', True):
                self.agent_stats[agent_name]['successful_requests'] += 1
            else:
                self.agent_stats[agent_name]['failed_requests'] += 1
            
            # Оновлюємо статистику
            self._update_agent_stats(agent_name, execution_time)
            
            return result
            
        except Exception as e:
            execution_time = time.time() - start_time
            self.agent_stats[agent_name]['failed_requests'] += 1
            self._update_agent_stats(agent_name, execution_time)
            
            logger.error(f"❌ Agent {agent_name} execution failed: {e}")
            
            return {
                'success': False,
                'response': f"Агент {agent_name} не зміг виконати завдання: {str(e)}",
                'evidence': {},
                'error': str(e)
            }
    
    async def _execute_via_goose(self, agent_name: str, request, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Виконує завдання через Goose"""
        
        if not self.goose_executor:
            raise Exception("Goose Executor not available")
        
        # Створюємо завдання для Goose
        from goose_executor import ExecutionTask
        
        # Генеруємо інструкції для агента через AI
        instructions = await self._generate_agent_instructions(agent_name, request, analysis)
        
        task = ExecutionTask(
            task_id=f"{agent_name}_{int(time.time())}",
            description=instructions,
            context={
                'agent': agent_name,
                'user_request': request.user_message,
                'analysis': analysis,
                'session_id': request.session_id
            },
            session_id=request.session_id,
            timeout_seconds=self.agents[agent_name]['timeout'],
            require_evidence=True
        )
        
        # Виконуємо через Goose
        execution_result = await self.goose_executor.execute_task(task)
        
        return {
            'success': execution_result.success,
            'response': execution_result.output,
            'evidence': execution_result.evidence,
            'execution_time': execution_result.execution_time,
            'error': execution_result.error_message,
            'agent': agent_name,
            'execution_method': 'goose'
        }
    
    async def _execute_via_ai_api(self, agent_name: str, request, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Виконує завдання через AI API"""
        
        # Генеруємо промпт для агента
        agent_prompt = await self._generate_agent_prompt(agent_name, request, analysis)
        
        # Викликаємо AI API
        ai_response = await self._call_ai_api(agent_prompt, f"{agent_name}_execution")
        
        if ai_response and 'choices' in ai_response:
            response_text = ai_response['choices'][0]['message']['content']
            
            return {
                'success': True,
                'response': response_text,
                'evidence': {
                    'agent': agent_name,
                    'method': 'ai_api',
                    'prompt_used': agent_prompt[:200] + "..." if len(agent_prompt) > 200 else agent_prompt
                },
                'execution_time': 0,  # AI API час рахується в intelligent_engine
                'agent': agent_name,
                'execution_method': 'ai_api'
            }
        else:
            raise Exception("No response from AI API")
    
    async def _generate_agent_instructions(self, agent_name: str, request, analysis: Dict[str, Any]) -> str:
        """Генерує інструкції для агента через AI"""
        
        instruction_prompt = f"""
        Створи детальні інструкції для агента {agent_name} системи ATLAS.
        
        Агент: {self.agents[agent_name]['description']}
        Ролі: {self.agents[agent_name]['role']}
        Можливості: {', '.join(self.agents[agent_name]['capabilities'])}
        
        Запит користувача: "{request.user_message}"
        Аналіз завдання: {json.dumps(analysis, ensure_ascii=False)}
        
        Інструкції мають бути:
        1. Конкретними та виконуваними
        2. Відповідати ролі агента
        3. Включати очікувані результати
        4. Вказувати які інструменти використовувати
        
        Поверни тільки текст інструкцій без додаткових пояснень.
        """
        
        ai_response = await self._call_ai_api(instruction_prompt, f"{agent_name}_instructions")
        
        if ai_response and 'choices' in ai_response:
            return ai_response['choices'][0]['message']['content']
        else:
            # Fallback інструкції
            return f"Виконай завдання користувача: {request.user_message}"
    
    async def _generate_agent_prompt(self, agent_name: str, request, analysis: Dict[str, Any]) -> str:
        """Генерує промпт для агента"""
        
        agent_config = self.agents[agent_name]
        
        # Базовий системний промпт для агента
        system_prompts = {
            'atlas': """
Ти - Atlas, стратег та планувальник системи ATLAS. 
Твоя роль - аналізувати завдання та створювати детальні плани виконання.

Принципи роботи:
- Розбивай складні завдання на прості кроки
- Аналізуй ризики та можливі проблеми
- Надавай чіткі інструкції для виконавців
- Думай стратегічно та системно

Відповідай українською мовою, будь точним та структурованим.
""",
            
            'tetyana': """
Ти - Тетяна, виконавець завдань системи ATLAS.
Твоя роль - реально виконувати завдання використовуючи інструменти системи.

Принципи роботи:
- Використовуй реальні інструменти (файли, додатки, браузер)
- Виконуй завдання поетапно та ретельно
- Збирай докази виконання
- Звітуй про результати детально

Формат звіту:
1. РЕЗЮМЕ: що зроблено
2. КРОКИ: список дій
3. РЕЗУЛЬТАТИ: конкретні досягнення
4. ДОКАЗИ: файли, команди, скріншоти
5. СТАТУС: завершено/частково/помилка

Відповідай українською мовою.
""",
            
            'grisha': """
Ти - Гриша, валідатор та перевіряючий системи ATLAS.
Твоя роль - перевіряти якість та відповідність результатів виконання.

Принципи роботи:
- Перевіряй відповідність результатів завданню
- Аналізуй якість виконання
- Шукай помилки та недоліки
- Надавай конструктивний фідбек

Формат перевірки:
1. ОЦІНКА: відповідність завданню (1-10)
2. ЯКІСТЬ: оцінка виконання (1-10)
3. ПРОБЛЕМИ: виявлені недоліки
4. РЕКОМЕНДАЦІЇ: як покращити
5. ВИСНОВОК: прийнято/потребує доопрацювання

Будь об'єктивним але конструктивним. Відповідай українською мовою.
"""
        }
        
        # Формуємо повний промпт
        prompt_parts = [
            system_prompts.get(agent_name, f"Ти - агент {agent_name} системи ATLAS."),
            "",
            f"ЗАВДАННЯ КОРИСТУВАЧА: {request.user_message}",
            ""
        ]
        
        # Додаємо аналіз якщо є
        if analysis:
            prompt_parts.extend([
                "АНАЛІЗ ЗАВДАННЯ:",
                json.dumps(analysis, ensure_ascii=False, indent=2),
                ""
            ])
        
        # Додаємо контекст сесії якщо є
        session_context = getattr(request, 'context', {})
        if session_context:
            prompt_parts.extend([
                "КОНТЕКСТ СЕСІЇ:",
                json.dumps(session_context, ensure_ascii=False, indent=2),
                ""
            ])
        
        prompt_parts.append("Виконай своє завдання згідно з принципами роботи.")
        
        return "\n".join(prompt_parts)
    
    def _update_agent_stats(self, agent_name: str, execution_time: float):
        """Оновлює статистику агента"""
        stats = self.agent_stats[agent_name]
        
        # Оновлюємо середній час відповіді
        total = stats['total_requests']
        current_avg = stats['average_response_time']
        stats['average_response_time'] = (current_avg * (total - 1) + execution_time) / total
        stats['last_used'] = time.time()
    
    async def _call_ai_api(self, prompt: str, operation: str) -> Optional[Dict[str, Any]]:
        """Викликає AI API"""
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "model": "gpt-4o-mini",
                    "messages": [
                        {"role": "user", "content": prompt}
                    ],
                    "stream": False,
                    "temperature": 0.7
                }
                
                async with session.post(
                    f"{self.ai_api_base}/chat/completions",
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=30)
                ) as response:
                    if response.status == 200:
                        return await response.json()
                    else:
                        logger.warning(f"AI API returned status {response.status} for {operation}")
                        return None
                        
        except Exception as e:
            logger.error(f"AI API call failed for {operation}: {e}")
            return None
    
    async def get_agent_capabilities(self, agent_name: str) -> Dict[str, Any]:
        """Повертає можливості агента"""
        if agent_name not in self.agents:
            return {}
        
        agent = self.agents[agent_name]
        stats = self.agent_stats[agent_name]
        
        return {
            'name': agent_name,
            'role': agent['role'],
            'description': agent['description'],
            'capabilities': agent['capabilities'],
            'uses_goose': agent['uses_goose'],
            'timeout_seconds': agent['timeout'],
            'statistics': stats.copy()
        }
    
    async def get_status(self) -> Dict[str, Any]:
        """Повертає статус системи агентів"""
        status = {
            'agents_count': len(self.agents),
            'ai_api_base': self.ai_api_base,
            'agents': {}
        }
        
        for agent_name in self.agents:
            status['agents'][agent_name] = await self.get_agent_capabilities(agent_name)
        
        return status
    
    async def shutdown(self):
        """Завершує роботу системи агентів"""
        logger.info("🔄 Shutting down Agent System...")
        # Очищаємо статистику або зберігаємо якщо потрібно
        logger.info("✅ Agent System shutdown complete")