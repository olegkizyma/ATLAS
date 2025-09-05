#!/usr/bin/env python3
"""
ATLAS Intelligent Engine
Головний AI движок повністю інтелігентної системи ATLAS
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
import aiohttp
import sys
from pathlib import Path

# Додаємо config до sys.path
config_path = Path(__file__).parent.parent / 'config'
sys.path.insert(0, str(config_path))

from dynamic_config import DynamicConfigManager

logger = logging.getLogger('atlas.intelligent_engine')

@dataclass
class IntelligentRequest:
    """Інтелігентний запит користувача"""
    user_message: str
    session_id: str
    timestamp: float
    context: Dict[str, Any]
    metadata: Dict[str, Any]

@dataclass
class IntelligentResponse:
    """Інтелігентна відповідь системи"""
    success: bool
    response_text: str
    agent_used: str
    execution_evidence: Dict[str, Any]
    tts_ready: bool = True
    needs_continuation: bool = False

class IntelligentEngine:
    """Головний AI движок системи ATLAS"""
    
    def __init__(self):
        self.config_manager = DynamicConfigManager()
        self.config = {}
        self.ai_api_base = "http://127.0.0.1:3010/v1"
        self.sessions = {}
        self.is_initialized = False
        
        # Імпортуємо інші компоненти системи лениво
        self.goose_executor = None
        self.voice_system = None
        self.agent_system = None
    
    async def initialize(self) -> bool:
        """Ініціалізує всю інтелігентну систему"""
        try:
            logger.info("🧠 Initializing ATLAS Intelligent Engine...")
            
            # Генеруємо динамічну конфігурацію через AI
            await self._generate_intelligent_config()
            
            # Ініціалізуємо компоненти системи
            await self._initialize_components()
            
            # Перевіряємо готовність системи
            await self._verify_system_readiness()
            
            self.is_initialized = True
            logger.info("✅ ATLAS Intelligent Engine initialized successfully")
            return True
            
        except Exception as e:
            logger.error(f"❌ Failed to initialize Intelligent Engine: {e}")
            return False
    
    async def _generate_intelligent_config(self):
        """Генерує інтелігентну конфігурацію через AI API"""
        logger.info("🔧 Generating intelligent configuration...")
        
        # Запитуємо AI про оптимальні налаштування системи
        config_prompt = """
        Ти - експерт по конфігурації AI систем. Згенеруй оптимальну конфігурацію для системи ATLAS.
        
        Система складається з:
        - AI движка (ти)
        - 3 агентів: Atlas (планувальник), Tetyana (виконавець), Grisha (валідатор)
        - Goose executor для реального виконання завдань
        - TTS/STT система для голосового інтерфейсу
        - Веб-інтерфейс
        
        Поверни JSON конфігурацію з налаштуваннями для максимальної ефективності та надійності.
        Включи timeouts, retry policies, agent behaviors, system limits.
        """
        
        try:
            config_response = await self._call_ai_api(config_prompt, "config_generation")
            
            # Парсимо відповідь AI
            if config_response and 'choices' in config_response:
                content = config_response['choices'][0]['message']['content']
                
                # Витягуємо JSON з відповіді
                import re
                json_match = re.search(r'\{.*\}', content, re.DOTALL)
                if json_match:
                    self.config = json.loads(json_match.group(0))
                else:
                    # Fallback до базової конфігурації
                    self.config = self._get_fallback_config()
            else:
                self.config = self._get_fallback_config()
                
        except Exception as e:
            logger.warning(f"AI config generation failed, using fallback: {e}")
            self.config = self._get_fallback_config()
        
        logger.info(f"Configuration generated with {len(self.config)} sections")
    
    def _get_fallback_config(self) -> Dict[str, Any]:
        """Базова fallback конфігурація"""
        return {
            "system": {
                "max_concurrent_requests": 5,
                "request_timeout_seconds": 30,
                "retry_attempts": 3,
                "health_check_interval": 60
            },
            "agents": {
                "atlas": {
                    "role": "planner",
                    "timeout_seconds": 15,
                    "max_context_tokens": 8000
                },
                "tetyana": {
                    "role": "executor", 
                    "timeout_seconds": 60,
                    "max_context_tokens": 12000,
                    "requires_goose": True
                },
                "grisha": {
                    "role": "validator",
                    "timeout_seconds": 20, 
                    "max_context_tokens": 10000
                }
            },
            "voice": {
                "tts_enabled": True,
                "stt_enabled": True,
                "tts_timeout_seconds": 10,
                "stt_timeout_seconds": 15
            },
            "goose": {
                "base_url": "http://127.0.0.1:3000",
                "timeout_seconds": 60,
                "retry_attempts": 2
            }
        }
    
    async def _initialize_components(self):
        """Ініціалізує компоненти системи"""
        logger.info("🔧 Initializing system components...")
        
        # Ініціалізуємо GooseExecutor
        from goose_executor import GooseExecutor
        self.goose_executor = GooseExecutor(self.config.get('goose', {}))
        await self.goose_executor.initialize()
        
        # Ініціалізуємо VoiceSystem
        from voice_system import VoiceSystem
        self.voice_system = VoiceSystem(self.config.get('voice', {}))
        await self.voice_system.initialize()
        
        # Ініціалізуємо AgentSystem
        from agent_system import AgentSystem
        self.agent_system = AgentSystem(
            self.config.get('agents', {}),
            self.ai_api_base,
            self.goose_executor
        )
        await self.agent_system.initialize()
    
    async def _verify_system_readiness(self):
        """Перевіряє готовність всіх компонентів"""
        logger.info("🔍 Verifying system readiness...")
        
        # Перевіряємо AI API
        health_check = await self._call_ai_api("ping", "health_check")
        if not health_check:
            raise Exception("AI API not responding")
        
        # Перевіряємо Goose
        if not await self.goose_executor.health_check():
            logger.warning("Goose not available - some functions may be limited")
        
        # Перевіряємо TTS/STT
        if not await self.voice_system.health_check():
            logger.warning("Voice system not available - voice features disabled")
        
        logger.info("✅ System readiness verified")
    
    async def process_intelligent_request(self, request: IntelligentRequest) -> IntelligentResponse:
        """Обробляє інтелігентний запит користувача"""
        if not self.is_initialized:
            raise Exception("Engine not initialized")
        
        try:
            logger.info(f"🧠 Processing intelligent request: {request.user_message[:100]}...")
            
            # Аналізуємо запит через AI
            analysis = await self._analyze_request_with_ai(request)
            
            # Вибираємо агента через AI
            selected_agent = await self._select_agent_with_ai(request, analysis)
            
            # Виконуємо завдання через вибраного агента
            execution_result = await self.agent_system.execute_with_agent(
                selected_agent, request, analysis
            )
            
            # Формуємо інтелігентну відповідь
            response = await self._generate_intelligent_response(
                request, analysis, selected_agent, execution_result
            )
            
            # Зберігаємо в сесії для контексту
            self._update_session_context(request.session_id, request, response)
            
            return response
            
        except Exception as e:
            logger.error(f"❌ Request processing failed: {e}")
            
            # Інтелігентне відновлення через AI
            recovery_response = await self._intelligent_error_recovery(request, str(e))
            return recovery_response
    
    async def _analyze_request_with_ai(self, request: IntelligentRequest) -> Dict[str, Any]:
        """Аналізує запит користувача через AI"""
        
        analysis_prompt = f"""
        Проаналізуй запит користувача та визнач:
        1. Тип завдання (планування, виконання, перевірка, розмова)
        2. Складність (низька, середня, висока)
        3. Терміновість (низька, нормальна, висока)
        4. Потрібні ресурси (Goose виконання, голос, веб-доступ)
        5. Очікуваний результат
        
        Запит: "{request.user_message}"
        Контекст сесії: {json.dumps(self.sessions.get(request.session_id, {}), ensure_ascii=False)}
        
        Поверни JSON аналіз.
        """
        
        ai_response = await self._call_ai_api(analysis_prompt, "request_analysis")
        
        if ai_response and 'choices' in ai_response:
            content = ai_response['choices'][0]['message']['content']
            try:
                return json.loads(content)
            except:
                # Fallback аналіз
                return {
                    "task_type": "execution",
                    "complexity": "medium", 
                    "urgency": "normal",
                    "needs_goose": True,
                    "needs_voice": False
                }
        
        return {"task_type": "unknown", "complexity": "medium"}
    
    async def _select_agent_with_ai(self, request: IntelligentRequest, analysis: Dict[str, Any]) -> str:
        """Вибирає оптимального агента через AI"""
        
        selection_prompt = f"""
        Вибери найкращого агента для виконання завдання:
        
        Доступні агенти:
        - Atlas: планувальник та стратег, створює детальні плани
        - Tetyana: виконавець, має доступ до Goose та інструментів системи
        - Grisha: валідатор, перевіряє результати та якість виконання
        
        Запит: "{request.user_message}"
        Аналіз: {json.dumps(analysis, ensure_ascii=False)}
        
        Поверни тільки ім'я агента: atlas, tetyana, або grisha
        """
        
        ai_response = await self._call_ai_api(selection_prompt, "agent_selection")
        
        if ai_response and 'choices' in ai_response:
            content = ai_response['choices'][0]['message']['content'].lower().strip()
            if content in ['atlas', 'tetyana', 'grisha']:
                return content
        
        # Fallback логіка
        task_type = analysis.get('task_type', 'execution')
        if task_type == 'planning':
            return 'atlas'
        elif task_type == 'execution':
            return 'tetyana'
        elif task_type == 'validation':
            return 'grisha'
        else:
            return 'atlas'  # Default
    
    async def _generate_intelligent_response(self, request: IntelligentRequest, 
                                           analysis: Dict[str, Any], agent: str,
                                           execution_result: Dict[str, Any]) -> IntelligentResponse:
        """Генерує інтелігентну відповідь"""
        
        response_prompt = f"""
        Сформуй відповідь користувачу на основі результатів виконання:
        
        Запит користувача: "{request.user_message}"
        Агент який виконував: {agent}
        Результат виконання: {json.dumps(execution_result, ensure_ascii=False)}
        
        Сформуй природню українську відповідь що:
        1. Підтверджує виконання завдання
        2. Пояснює що було зроблено
        3. Надає конкретні результати
        4. Пропонує наступні кроки якщо потрібно
        
        Відповідь має бути дружньою та професійною.
        """
        
        ai_response = await self._call_ai_api(response_prompt, "response_generation")
        
        response_text = "Завдання опрацьовано."  # Fallback
        if ai_response and 'choices' in ai_response:
            response_text = ai_response['choices'][0]['message']['content']
        
        return IntelligentResponse(
            success=execution_result.get('success', True),
            response_text=response_text,
            agent_used=agent,
            execution_evidence=execution_result.get('evidence', {}),
            tts_ready=True,
            needs_continuation=execution_result.get('needs_continuation', False)
        )
    
    async def _intelligent_error_recovery(self, request: IntelligentRequest, error: str) -> IntelligentResponse:
        """Інтелігентне відновлення після помилки"""
        
        recovery_prompt = f"""
        Система зіткнулася з помилкою при обробці запиту. Визнач найкращу стратегію відновлення:
        
        Запит: "{request.user_message}"
        Помилка: "{error}"
        
        Варіанти відновлення:
        1. Повторити спробу з іншими параметрами
        2. Розбити завдання на менші частини
        3. Використати альтернативний підхід
        4. Попросити уточнення у користувача
        
        Поверни JSON з планом відновлення та повідомленням для користувача.
        """
        
        ai_response = await self._call_ai_api(recovery_prompt, "error_recovery")
        
        recovery_message = f"Виникла помилка при обробці запиту. Спробуйте перефразувати або уточнити завдання."
        
        if ai_response and 'choices' in ai_response:
            content = ai_response['choices'][0]['message']['content']
            try:
                recovery_plan = json.loads(content)
                recovery_message = recovery_plan.get('user_message', recovery_message)
            except:
                pass
        
        return IntelligentResponse(
            success=False,
            response_text=recovery_message,
            agent_used="system",
            execution_evidence={"error": error, "recovery_attempted": True},
            tts_ready=True,
            needs_continuation=False
        )
    
    def _update_session_context(self, session_id: str, request: IntelligentRequest, response: IntelligentResponse):
        """Оновлює контекст сесії"""
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                "created_at": time.time(),
                "messages": [],
                "agent_preferences": {},
                "context": {}
            }
        
        session = self.sessions[session_id]
        session["messages"].append({
            "timestamp": request.timestamp,
            "user_message": request.user_message,
            "agent_response": response.response_text,
            "agent_used": response.agent_used,
            "success": response.success
        })
        
        # Обмежуємо історію для продуктивності
        if len(session["messages"]) > 20:
            session["messages"] = session["messages"][-15:]
    
    async def _call_ai_api(self, prompt: str, operation: str) -> Optional[Dict[str, Any]]:
        """Викликає локальне AI API"""
        try:
            async with aiohttp.ClientSession() as session:
                payload = {
                    "model": "gpt-4o-mini",  # Модель за замовчуванням
                    "messages": [
                        {"role": "system", "content": "Ти - розумний помічник системи ATLAS. Відповідай українською мовою, будь точним та корисним."},
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
    
    async def get_system_status(self) -> Dict[str, Any]:
        """Повертає статус всієї системи"""
        status = {
            "engine_initialized": self.is_initialized,
            "timestamp": time.time(),
            "active_sessions": len(self.sessions),
            "config_sections": len(self.config),
            "components": {}
        }
        
        if self.goose_executor:
            status["components"]["goose"] = await self.goose_executor.get_status()
        
        if self.voice_system:
            status["components"]["voice"] = await self.voice_system.get_status()
        
        if self.agent_system:
            status["components"]["agents"] = await self.agent_system.get_status()
        
        return status
    
    async def shutdown(self):
        """Завершує роботу системи"""
        logger.info("🔄 Shutting down Intelligent Engine...")
        
        if self.goose_executor:
            await self.goose_executor.shutdown()
        
        if self.voice_system:
            await self.voice_system.shutdown()
        
        if self.agent_system:
            await self.agent_system.shutdown()
        
        logger.info("✅ Intelligent Engine shutdown complete")

# Глобальний instance движка
intelligent_engine = IntelligentEngine()