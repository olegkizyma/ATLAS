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
            for client in self.connected_clients:
                try:
                    await client.send(json.dumps(message))
                except websockets.exceptions.ConnectionClosed:
                    disconnected.add(client)
            
            # Видаляємо відключені клієнти
            self.connected_clients -= disconnected
    
    def generate_js_integration_code(self) -> str:
        """Генерує код для інтеграції з JavaScript оркестратором"""
        
        return f'''
// ATLAS Recovery System Integration
// Додайте цей код до server.js для інтеграції з Python системою відновлення

const WebSocket = require('ws');

class RecoverySystemBridge {{
    constructor() {{
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.pendingRequests = new Map();
        
        this.connect();
    }}
    
    connect() {{
        try {{
            this.ws = new WebSocket('ws://127.0.0.1:{self.ws_port}');
            
            this.ws.on('open', () => {{
                console.log('[RecoveryBridge] Connected to Python recovery system');
                this.reconnectAttempts = 0;
            }});
            
            this.ws.on('message', (data) => {{
                try {{
                    const message = JSON.parse(data);
                    this.handleMessage(message);
                }} catch (e) {{
                    console.error('[RecoveryBridge] Failed to parse message:', e);
                }}
            }});
            
            this.ws.on('close', () => {{
                console.log('[RecoveryBridge] Connection closed');
                this.scheduleReconnect();
            }});
            
            this.ws.on('error', (error) => {{
                console.error('[RecoveryBridge] WebSocket error:', error);
            }});
            
        }} catch (e) {{
            console.error('[RecoveryBridge] Connection failed:', e);
            this.scheduleReconnect();
        }}
    }}
    
    scheduleReconnect() {{
        if (this.reconnectAttempts < this.maxReconnectAttempts) {{
            this.reconnectAttempts++;
            const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
            
            console.log(`[RecoveryBridge] Reconnecting in ${{delay}}ms (attempt ${{this.reconnectAttempts}}/${{this.maxReconnectAttempts}})`);
            
            setTimeout(() => {{
                this.connect();
            }}, delay);
        }} else {{
            console.error('[RecoveryBridge] Max reconnection attempts reached');
        }}
    }}
    
    handleMessage(message) {{
        const {{ type, payload, request_id }} = message;
        
        if (request_id && this.pendingRequests.has(request_id)) {{
            const {{ resolve, reject }} = this.pendingRequests.get(request_id);
            this.pendingRequests.delete(request_id);
            
            if (type === 'error') {{
                reject(new Error(payload.error));
            }} else {{
                resolve(payload);
            }}
        }}
    }}
    
    sendRequest(type, payload) {{
        return new Promise((resolve, reject) => {{
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {{
                reject(new Error('Recovery system not connected'));
                return;
            }}
            
            const request_id = `req_${{Date.now()}}_${{Math.random().toString(36).substr(2, 9)}}`;
            
            this.pendingRequests.set(request_id, {{ resolve, reject }});
            
            this.ws.send(JSON.stringify({{
                type,
                payload,
                request_id
            }}));
            
            // Timeout після 30 секунд
            setTimeout(() => {{
                if (this.pendingRequests.has(request_id)) {{
                    this.pendingRequests.delete(request_id);
                    reject(new Error('Request timeout'));
                }}
            }}, 30000);
        }});
    }}
    
    async requestRecovery(failureData) {{
        try {{
            const result = await this.sendRequest('recovery_request', failureData);
            return result;
        }} catch (e) {{
            console.error('[RecoveryBridge] Recovery request failed:', e);
            return null;
        }}
    }}
    
    async getHealthStatus() {{
        try {{
            const health = await this.sendRequest('health_check', {{}});
            return health;
        }} catch (e) {{
            console.error('[RecoveryBridge] Health check failed:', e);
            return null;
        }}
    }}
    
    async getStats() {{
        try {{
            const stats = await this.sendRequest('stats_request', {{}});
            return stats;
        }} catch (e) {{
            console.error('[RecoveryBridge] Stats request failed:', e);
            return null;
        }}
    }}
}}

// Глобальний екземпляр
const recoveryBridge = new RecoverySystemBridge();

// Функція для інтеграції з існуючою логікою обробки помилок
async function handleExecutionFailure(executionResult, context) {{
    try {{
        const failureData = {{
            error_message: executionResult.error || 'Execution failed',
            agent_name: executionResult.agent || 'unknown',
            attempt_count: executionResult.attempts || 1,
            partial_success: executionResult.partialSuccess || false,
            user_request: context.userRequest || '',
            task_spec: context.taskSpec || {{}},
            context: context,
            session_id: context.sessionId || 'unknown',
            metadata: executionResult.metadata || {{}}
        }};
        
        const recoveryResult = await recoveryBridge.requestRecovery(failureData);
        
        if (recoveryResult && recoveryResult.success) {{
            console.log('[RecoverySystem] Recovery plan generated:', recoveryResult.recovery_result);
            return recoveryResult.recommendations;
        }} else {{
            console.error('[RecoverySystem] Recovery failed:', recoveryResult?.error);
            return null;
        }}
    }} catch (e) {{
        console.error('[RecoverySystem] Recovery handling error:', e);
        return null;
    }}
}}

// Експортуємо для використання
module.exports = {{
    recoveryBridge,
    handleExecutionFailure
}};
'''
    
    async def run(self):
        """Запускає recovery bridge"""
        
        logger.info("Starting ATLAS Recovery Bridge...")
        
        # Запускаємо WebSocket сервер
        server = await self.start_websocket_server()
        
        # Генеруємо код інтеграції
        integration_code = self.generate_js_integration_code()
        integration_path = Path(__file__).parent / 'recovery_bridge_integration.js'
        
        with open(integration_path, 'w', encoding='utf-8') as f:
            f.write(integration_code)
        
        logger.info(f"Integration code generated: {integration_path}")
        logger.info("Recovery Bridge is running. Press Ctrl+C to stop.")
        
        try:
            # Тримаємо сервер запущеним
            await server.wait_closed()
        except KeyboardInterrupt:
            logger.info("Shutting down Recovery Bridge...")
            server.close()
            await server.wait_closed()

# CLI для запуску bridge
if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description='ATLAS Recovery Bridge')
    parser.add_argument('--orchestrator-port', type=int, default=5101, help='Orchestrator port (default: 5101)')
    parser.add_argument('--bridge-port', type=int, default=5102, help='Bridge WebSocket port (default: 5102)')
    parser.add_argument('--log-level', choices=['DEBUG', 'INFO', 'WARNING', 'ERROR'], default='INFO', help='Log level')
    
    args = parser.parse_args()
    
    # Налаштування логування
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    
    # Створюємо та запускаємо bridge
    bridge = RecoveryBridge(orchestrator_port=args.orchestrator_port)
    bridge.ws_port = args.bridge_port
    
    try:
        asyncio.run(bridge.run())
    except KeyboardInterrupt:
        print("\nShutdown completed.")
