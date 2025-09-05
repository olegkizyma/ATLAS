#!/usr/bin/env python3
"""
ATLAS Goose Executor
Виконавець завдань через Goose для реального виконання
"""

import asyncio
import json
import logging
import time
from typing import Dict, Any, Optional
import aiohttp
import websockets
from dataclasses import dataclass

logger = logging.getLogger('atlas.goose_executor')

@dataclass
class ExecutionTask:
    """Завдання для виконання"""
    task_id: str
    description: str
    context: Dict[str, Any]
    session_id: str
    timeout_seconds: int = 60
    require_evidence: bool = True

@dataclass
class ExecutionResult:
    """Результат виконання"""
    success: bool
    task_id: str
    output: str
    evidence: Dict[str, Any]
    execution_time: float
    error_message: Optional[str] = None

class GooseExecutor:
    """Виконавець завдань через Goose з підтримкою real execution"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.base_url = config.get('base_url', 'http://127.0.0.1:3000')
        self.timeout_seconds = config.get('timeout_seconds', 60)
        self.retry_attempts = config.get('retry_attempts', 2)
        
        self.is_available = False
        self.last_health_check = 0
        self.health_check_interval = 30  # секунд
        
        # Статистика виконання
        self.stats = {
            'total_executions': 0,
            'successful_executions': 0,
            'failed_executions': 0,
            'average_execution_time': 0,
            'last_execution_time': 0
        }
    
    async def initialize(self) -> bool:
        """Ініціалізує Goose Executor"""
        logger.info("🦢 Initializing Goose Executor...")
        
        try:
            # Перевіряємо доступність Goose
            await self.health_check()
            
            if self.is_available:
                logger.info("✅ Goose Executor initialized successfully")
                return True
            else:
                logger.warning("⚠️ Goose not available - execution capabilities limited")
                return False
                
        except Exception as e:
            logger.error(f"❌ Failed to initialize Goose Executor: {e}")
            return False
    
    async def health_check(self) -> bool:
        """Перевіряє здоров'я Goose сервера"""
        current_time = time.time()
        
        # Кешуємо результат health check
        if current_time - self.last_health_check < self.health_check_interval:
            return self.is_available
        
        try:
            async with aiohttp.ClientSession() as session:
                # Спочатку пробуємо /health endpoint
                async with session.get(
                    f"{self.base_url}/health",
                    timeout=aiohttp.ClientTimeout(total=5)
                ) as response:
                    if response.status == 200:
                        self.is_available = True
                        self.last_health_check = current_time
                        return True
        except:
            pass
        
        try:
            # Fallback до WebSocket підключення
            async with websockets.connect(
                self.base_url.replace('http', 'ws') + '/ws',
                timeout=5
            ) as websocket:
                await websocket.ping()
                self.is_available = True
                self.last_health_check = current_time
                return True
                
        except Exception as e:
            logger.warning(f"Goose health check failed: {e}")
            self.is_available = False
            self.last_health_check = current_time
            return False
    
    async def execute_task(self, task: ExecutionTask) -> ExecutionResult:
        """Виконує завдання через Goose"""
        start_time = time.time()
        self.stats['total_executions'] += 1
        
        logger.info(f"🦢 Executing task {task.task_id}: {task.description[:100]}...")
        
        try:
            # Перевіряємо доступність Goose
            if not await self.health_check():
                raise Exception("Goose server not available")
            
            # Формуємо prompt для Goose з контекстом
            execution_prompt = self._build_execution_prompt(task)
            
            # Виконуємо через Goose
            result = await self._execute_via_goose(execution_prompt, task.session_id, task.timeout_seconds)
            
            # Обробляємо результат
            if result and result.get('success'):
                evidence = await self._collect_execution_evidence(task, result)
                
                execution_time = time.time() - start_time
                self._update_stats(execution_time, True)
                
                return ExecutionResult(
                    success=True,
                    task_id=task.task_id,
                    output=result.get('response', ''),
                    evidence=evidence,
                    execution_time=execution_time
                )
            else:
                error_msg = result.get('error', 'Unknown execution error') if result else 'No response from Goose'
                raise Exception(error_msg)
                
        except Exception as e:
            execution_time = time.time() - start_time
            self._update_stats(execution_time, False)
            
            logger.error(f"❌ Task {task.task_id} execution failed: {e}")
            
            return ExecutionResult(
                success=False,
                task_id=task.task_id,
                output="",
                evidence={},
                execution_time=execution_time,
                error_message=str(e)
            )
    
    def _build_execution_prompt(self, task: ExecutionTask) -> str:
        """Будує prompt для виконання завдання"""
        
        prompt_parts = [
            "Ти - Тетяна, виконавець завдань системи ATLAS.",
            "Твоє завдання - реально виконати користувацький запит використовуючи доступні інструменти.",
            "",
            f"ЗАВДАННЯ: {task.description}",
            "",
            "ІНСТРУКЦІЇ:",
            "1. Використовуй реальні інструменти системи (файли, браузер, додатки)",
            "2. Виконуй завдання поетапно та ретельно",
            "3. Збирай докази виконання (скріншоти, файли, виходи команд)",
            "4. Надавай детальний звіт про виконані дії",
            "",
            "ФОРМАТ ЗВІТУ:",
            "1. РЕЗЮМЕ: Короткий опис що зроблено",
            "2. КРОКИ: Список виконаних кроків", 
            "3. РЕЗУЛЬТАТИ: Конкретні результати з доказами",
            "4. ДОКАЗИ: Файли, шляхи, скріншоти, команди",
            "5. СТАТУС: ЗАВЕРШЕНО / ЧАСТКОВО / ПОМИЛКА",
            ""
        ]
        
        # Додаємо контекст якщо є
        if task.context:
            prompt_parts.extend([
                "КОНТЕКСТ:",
                json.dumps(task.context, ensure_ascii=False, indent=2),
                ""
            ])
        
        prompt_parts.append("Почни виконання ЗАРАЗ. Використовуй інструменти для реального виконання.")
        
        return "\n".join(prompt_parts)
    
    async def _execute_via_goose(self, prompt: str, session_id: str, timeout: int) -> Optional[Dict[str, Any]]:
        """Виконує prompt через Goose"""
        
        # Спочатку пробуємо WebSocket
        try:
            result = await self._execute_via_websocket(prompt, session_id, timeout)
            if result:
                return result
        except Exception as e:
            logger.warning(f"WebSocket execution failed: {e}")
        
        # Fallback до SSE
        try:
            result = await self._execute_via_sse(prompt, session_id, timeout)
            return result
        except Exception as e:
            logger.error(f"SSE execution failed: {e}")
            return None
    
    async def _execute_via_websocket(self, prompt: str, session_id: str, timeout: int) -> Optional[Dict[str, Any]]:
        """Виконує через WebSocket"""
        ws_url = self.base_url.replace('http', 'ws') + '/ws'
        
        try:
            async with websockets.connect(ws_url, timeout=timeout) as websocket:
                # Відправляємо повідомлення
                message = {
                    "type": "message",
                    "content": prompt,
                    "session_id": session_id,
                    "timestamp": int(time.time() * 1000)
                }
                
                await websocket.send(json.dumps(message))
                
                # Збираємо відповідь
                collected_response = ""
                
                while True:
                    try:
                        response = await asyncio.wait_for(websocket.recv(), timeout=timeout)
                        data = json.loads(response)
                        
                        if data.get('type') == 'response':
                            content = data.get('content', '')
                            if content:
                                collected_response += content
                        
                        elif data.get('type') in ['complete', 'cancelled']:
                            break
                            
                        elif data.get('type') == 'error':
                            return {'success': False, 'error': data.get('message', 'WebSocket error')}
                            
                    except asyncio.TimeoutError:
                        logger.warning("WebSocket response timeout")
                        break
                
                return {
                    'success': bool(collected_response.strip()),
                    'response': collected_response.strip() or "Завдання виконано (без тексту відповіді)"
                }
                
        except Exception as e:
            logger.error(f"WebSocket execution error: {e}")
            return None
    
    async def _execute_via_sse(self, prompt: str, session_id: str, timeout: int) -> Optional[Dict[str, Any]]:
        """Виконує через SSE"""
        url = f"{self.base_url}/reply"
        
        headers = {
            'Accept': 'text/event-stream',
            'Content-Type': 'application/json',
            'X-Secret-Key': 'test'  # Default Goose secret
        }
        
        messages = [
            {
                "role": "system",
                "created": int(time.time()),
                "content": [{"type": "text", "text": "Ти - Тетяна, виконавець завдань. Використовуй інструменти для реального виконання."}]
            },
            {
                "role": "user", 
                "created": int(time.time()),
                "content": [{"type": "text", "text": prompt}]
            }
        ]
        
        payload = {
            "messages": messages,
            "session_id": session_id,
            "session_working_dir": "/home",  # Default working directory
            "tool_choice": "auto"  # Дозволяємо використання інструментів
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(url, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)) as response:
                    
                    if response.status != 200:
                        return {'success': False, 'error': f'HTTP {response.status}'}
                    
                    collected_content = ""
                    
                    async for line in response.content:
                        line_str = line.decode('utf-8').strip()
                        
                        if line_str.startswith('data:'):
                            data_str = line_str[5:].strip()
                            
                            try:
                                data = json.loads(data_str)
                                
                                if data.get('type') == 'Message' and data.get('message', {}).get('content'):
                                    for content in data['message']['content']:
                                        if content.get('type') == 'text':
                                            text = content.get('text', '')
                                            if text:
                                                collected_content += text
                                
                                elif data.get('type') == 'Error':
                                    return {'success': False, 'error': data.get('error', 'Unknown SSE error')}
                                
                            except json.JSONDecodeError:
                                # Можливо, це plain text
                                if data_str and not data_str.startswith('['):
                                    collected_content += data_str
                    
                    return {
                        'success': bool(collected_content.strip()),
                        'response': collected_content.strip() or "Завдання виконано"
                    }
                    
        except Exception as e:
            logger.error(f"SSE execution error: {e}")
            return None
    
    async def _collect_execution_evidence(self, task: ExecutionTask, result: Dict[str, Any]) -> Dict[str, Any]:
        """Збирає докази виконання завдання"""
        
        evidence = {
            'task_id': task.task_id,
            'execution_timestamp': time.time(),
            'goose_response': result.get('response', ''),
            'execution_method': 'goose',
            'session_id': task.session_id
        }
        
        # Аналізуємо відповідь на предмет доказів
        response_text = result.get('response', '')
        
        # Шукаємо файли в відповіді
        import re
        file_patterns = [
            r'/[^\s]+\.(txt|json|py|html|css|js|png|jpg|jpeg|pdf)',
            r'~/[^\s]+\.[a-zA-Z0-9]+',
            r'\./[^\s]+\.[a-zA-Z0-9]+'
        ]
        
        found_files = []
        for pattern in file_patterns:
            matches = re.findall(pattern, response_text)
            found_files.extend(matches)
        
        if found_files:
            evidence['files_mentioned'] = found_files
        
        # Шукаємо команди в відповіді
        command_patterns = [
            r'`([^`]+)`',
            r'команда[:\s]+([^\n]+)',
            r'виконано[:\s]+([^\n]+)'
        ]
        
        found_commands = []
        for pattern in command_patterns:
            matches = re.findall(pattern, response_text, re.IGNORECASE)
            found_commands.extend(matches)
        
        if found_commands:
            evidence['commands_executed'] = found_commands
        
        return evidence
    
    def _update_stats(self, execution_time: float, success: bool):
        """Оновлює статистику виконання"""
        if success:
            self.stats['successful_executions'] += 1
        else:
            self.stats['failed_executions'] += 1
        
        # Оновлюємо середній час виконання
        total_exec = self.stats['total_executions']
        current_avg = self.stats['average_execution_time']
        self.stats['average_execution_time'] = (current_avg * (total_exec - 1) + execution_time) / total_exec
        self.stats['last_execution_time'] = execution_time
    
    async def get_status(self) -> Dict[str, Any]:
        """Повертає статус Goose Executor"""
        await self.health_check()  # Оновлюємо статус
        
        return {
            'available': self.is_available,
            'base_url': self.base_url,
            'last_health_check': self.last_health_check,
            'config': self.config,
            'stats': self.stats.copy()
        }
    
    async def shutdown(self):
        """Завершує роботу Goose Executor"""
        logger.info("🔄 Shutting down Goose Executor...")
        # Тут можна додати cleanup логіку якщо потрібно
        logger.info("✅ Goose Executor shutdown complete")