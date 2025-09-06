#!/usr/bin/env python3
"""
ATLAS Recovery Integration Bridge
Міст для інтеграції Python системи відновлення з JavaScript оркестратором
"""

import json
import asyncio
import logging
import subprocess
from typing import Dict, Any, Optional
from pathlib import Path
import websockets
import aiohttp
from intelligent_recovery import IntelligentRecoverySystem

logger = logging.getLogger('atlas.recovery_bridge')

class RecoveryBridge:
    """Міст між JavaScript оркестратором та Python системою відновлення"""
    
    def __init__(self, orchestrator_port: int = 5101):
        self.orchestrator_port = orchestrator_port
        self.orchestrator_url = f"http://127.0.0.1:{orchestrator_port}"
        self.recovery_system = IntelligentRecoverySystem(
            orchestrator_callback=self._call_js_orchestrator
        )
        
        # WebSocket сервер для комунікації з JS
        self.ws_port = 5102
        self.connected_clients = set()
    
    async def _call_js_orchestrator(self, task_spec: Dict[str, Any], context: Dict[str, Any], adaptations: Dict[str, Any]) -> Dict[str, Any]:
        """Викликає JavaScript оркестратор з адаптаціями"""
        
        try:
            # Формуємо запит до JS оркестратора
            payload = {
                'message': context.get('user_request', task_spec.get('summary', 'Виконати задачу')),
                'session_id': context.get('session_id', f'recovery-{int(asyncio.get_event_loop().time())}'),
                'adaptations': adaptations,
                'recovery_mode': True
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.orchestrator_url}/chat",
                    json=payload,
                    headers={'Content-Type': 'application/json'},
                    timeout=aiohttp.ClientTimeout(total=120)
                ) as response:
                    
                    if response.status == 200:
                        # Для SSE відповідей збираємо весь стрім
                        if response.content_type == 'text/event-stream':
                            result_text = ""
                            async for line in response.content:
                                if line:
                                    line_str = line.decode('utf-8').strip()
                                    if line_str.startswith('data: '):
                                        try:
                                            data = json.loads(line_str[6:])
                                            if data.get('type') == 'agent_message':
                                                result_text += data.get('content', '') + '\n'
                                        except json.JSONDecodeError:
                                            pass
                            
                            return {
                                'success': len(result_text.strip()) > 0,
                                'result': result_text.strip(),
                                'adaptations_applied': adaptations
                            }
                        else:
                            data = await response.json()
                            return {
                                'success': True,
                                'result': data,
                                'adaptations_applied': adaptations
                            }
                    else:
                        return {
                            'success': False,
                            'error': f'HTTP {response.status}: {await response.text()}',
                            'adaptations_applied': adaptations
                        }
        
        except Exception as e:
            logger.error(f"Failed to call JS orchestrator: {e}")
            return {
                'success': False,
                'error': str(e),
                'adaptations_applied': adaptations
            }
    
    async def handle_failure_request(self, failure_data: Dict[str, Any]) -> Dict[str, Any]:
        """Обробляє запит на відновлення від JS оркестратора"""
        
        try:
            # Витягаємо інформацію про невдачу
            execution_result = {
                'error_message': failure_data.get('error_message', 'Unknown error'),
                'agent_name': failure_data.get('agent_name', 'unknown'),
                'attempt_count': failure_data.get('attempt_count', 1),
                'partial_success': failure_data.get('partial_success', False),
                'metadata': failure_data.get('metadata', {})
            }
            
            context = {
                'user_request': failure_data.get('user_request', ''),
                'task_spec': failure_data.get('task_spec', {}),
                'execution_context': failure_data.get('context', {}),
                'session_id': failure_data.get('session_id', 'unknown')
            }
            
            # Запускаємо систему відновлення
            recovery_result = await self.recovery_system.handle_failure(execution_result, context)
            
            # Повертаємо результат у форматі, зрозумілому для JS
            return {
                'success': True,
                'recovery_result': recovery_result,
                'recommendations': self._generate_js_recommendations(recovery_result)
            }
        
        except Exception as e:
            logger.error(f"Recovery handling failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'recovery_result': None
            }
    
    def _generate_js_recommendations(self, recovery_result: Dict[str, Any]) -> Dict[str, Any]:
        """Генерує рекомендації для JS оркестратора"""
        
        if not recovery_result['recovery_successful']:
            return {
                'action': 'manual_intervention',
                'message': 'Автоматичне відновлення неможливе, потрібне ручне втручання',
                'fallback_available': recovery_result.get('recovery_plan', {}).get('fallback_plan') is not None
            }
        
        recovery_plan = recovery_result.get('recovery_plan', {})
        strategy = recovery_plan.get('strategy', 'unknown')
        
        recommendations = {
            'action': 'retry_with_adaptations',
            'strategy': strategy,
            'adaptations': recovery_plan.get('adaptation_parameters', {}),
            'estimated_success_rate': recovery_plan.get('estimated_success_rate', 0.5),
            'steps': recovery_plan.get('steps', [])
        }
        
        # Специфічні рекомендації базуючись на стратегії
        if strategy == 'retry_with_backoff':
            recommendations['wait_time'] = recovery_plan.get('resource_requirements', {}).get('time_estimate_seconds', 30)
        
        elif strategy == 'context_reduction':
            recommendations['reduce_context'] = True
            recommendations['context_reduction_factor'] = recovery_plan.get('adaptation_parameters', {}).get('reduce_context_factor', 0.7)
        
        elif strategy == 'decompose_task':
            recommendations['split_task'] = True
            recommendations['subtask_count'] = 3
        
        return recommendations
    
    async def start_websocket_server(self):
        """Запускає WebSocket сервер для комунікації з JS"""
        
        async def handle_websocket(websocket, path):
            """Обробляє WebSocket з'єднання"""
            self.connected_clients.add(websocket)
            logger.info(f"Recovery bridge client connected: {websocket.remote_address}")
            
            try:
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        
                        if data.get('type') == 'recovery_request':
                            # Обробляємо запит на відновлення
                            result = await self.handle_failure_request(data.get('payload', {}))
                            await websocket.send(json.dumps({
                                'type': 'recovery_response',
                                'payload': result,
                                'request_id': data.get('request_id')
                            }))
                        
                        elif data.get('type') == 'health_check':
                            # Перевірка стану системи
                            health = self.recovery_system.get_system_health_report()
                            await websocket.send(json.dumps({
                                'type': 'health_response',
                                'payload': health,
                                'request_id': data.get('request_id')
                            }))
                        
                        elif data.get('type') == 'stats_request':
                            # Запит статистики
                            stats = self.recovery_system.recovery_stats
                            await websocket.send(json.dumps({
                                'type': 'stats_response',
                                'payload': stats,
                                'request_id': data.get('request_id')
                            }))
                    
                    except json.JSONDecodeError as e:
                        await websocket.send(json.dumps({
                            'type': 'error',
                            'payload': {'error': f'Invalid JSON: {e}'}
                        }))
                    
                    except Exception as e:
                        logger.error(f"WebSocket message handling error: {e}")
                        await websocket.send(json.dumps({
                            'type': 'error',
                            'payload': {'error': str(e)}
                        }))
            
            except websockets.exceptions.ConnectionClosed:
                pass
            finally:
                self.connected_clients.discard(websocket)
                logger.info(f"Recovery bridge client disconnected")
        
        logger.info(f"Starting recovery bridge WebSocket server on port {self.ws_port}")
        return await websockets.serve(handle_websocket, "127.0.0.1", self.ws_port)
    
    async def notify_clients(self, message: Dict[str, Any]):
        """Сповіщає всіх підключених клієнтів"""
        if self.connected_clients:
            disconnected = set()
            # Iterate over a snapshot to avoid RuntimeError if the set changes while iterating
            for client in list(self.connected_clients):
                try:
                    await client.send(json.dumps(message))
                except websockets.exceptions.ConnectionClosed:
                    disconnected.add(client)
                except Exception as e:
                    logger.exception(f"Error sending to recovery client: {e}")

            # Видаляємо відключені клієнти
            if disconnected:
                self.connected_clients -= disconnected
    
    def generate_js_integration_code(self) -> str:
        """Генерує код для інтеграції з JavaScript оркестратором"""
        # Возвращаем компактный и безопасный JS-плейсхолдер вместо большого встроенного фрагмента.
        # Раніше ту
