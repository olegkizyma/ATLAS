"""
Atlas API Endpoints
Чисті ендпойнти без перезавантажень
"""
from flask import jsonify, request, Response
import json
import time
import logging
from threading import Thread
import queue

class AtlasAPI:
    def __init__(self, app, atlas_core):
        self.app = app
        self.atlas_core = atlas_core
        self.logger = logging.getLogger('atlas.api')
        
        # SSE connections
        self.sse_clients = {}
        self.response_queue = queue.Queue()
        
        # Реєструємо маршрути
        self._register_routes()
    
    def _register_routes(self):
        """Реєструємо API маршрути"""
        
        @self.app.route('/api/status')
        def api_status():
            """Статус системи"""
            try:
                return jsonify({
                    'status': 'ok',
                    'atlas_core_ready': self.atlas_core is not None,
                    'timestamp': time.time(),
                    'version': '2.0',
                    'uptime': time.time() - getattr(self, 'start_time', time.time())
                })
            except Exception as e:
                self.logger.error(f"Status check error: {e}")
                return jsonify({
                    'status': 'error',
                    'error': str(e),
                    'timestamp': time.time()
                }), 500
        
        @self.app.route('/api/chat', methods=['POST'])
        def api_chat():
            """Надіслати повідомлення в чат"""
            try:
                data = request.get_json()
                if not data or 'message' not in data:
                    return jsonify({'error': 'Message is required'}), 400
                
                message = data['message'].strip()
                if not message:
                    return jsonify({'error': 'Empty message'}), 400
                
                # Перевіряємо готовність
                if not self.atlas_core:
                    return jsonify({'error': 'Atlas Core not ready'}), 503
                
                # Генеруємо ID для відповіді
                response_id = f"resp_{int(time.time() * 1000)}"
                
                # Запускаємо обробку повідомлення
                Thread(
                    target=self._process_message,
                    args=(message, response_id),
                    daemon=True
                ).start()
                
                return jsonify({
                    'status': 'accepted',
                    'response_id': response_id,
                    'timestamp': time.time()
                })
                
            except Exception as e:
                self.logger.error(f"Chat error: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/stream/<response_id>')
        def api_stream(response_id):
            """SSE стрім для відповідей"""
            try:
                def generate():
                    client_id = f"{response_id}_{time.time()}"
                    self.sse_clients[client_id] = True
                    
                    try:
                        # Заголовки SSE
                        yield "data: " + json.dumps({
                            'type': 'connection',
                            'message': 'Connected to stream',
                            'response_id': response_id,
                            'timestamp': time.time()
                        }) + "\n\n"
                        
                        # Чекаємо відповіді
                        start_time = time.time()
                        timeout = 30  # 30 секунд таймаут
                        
                        while client_id in self.sse_clients:
                            try:
                                # Отримуємо дані з черги
                                data = self.response_queue.get(timeout=1)
                                if data['response_id'] == response_id:
                                    yield f"data: {json.dumps(data)}\n\n"
                                    
                                    # Якщо це кінець відповіді
                                    if data.get('type') == 'complete':
                                        break
                                        
                            except queue.Empty:
                                # Heartbeat кожну секунду
                                yield f"data: {json.dumps({'type': 'heartbeat', 'timestamp': time.time()})}\n\n"
                                
                                # Перевіряємо таймаут
                                if time.time() - start_time > timeout:
                                    yield f"data: {json.dumps({'type': 'timeout', 'message': 'Stream timeout'})}\n\n"
                                    break
                    
                    finally:
                        # Очищаємо клієнта
                        if client_id in self.sse_clients:
                            del self.sse_clients[client_id]
                
                return Response(
                    generate(),
                    mimetype='text/event-stream',
                    headers={
                        'Cache-Control': 'no-cache',
                        'Connection': 'keep-alive',
                        'Access-Control-Allow-Origin': '*'
                    }
                )
                
            except Exception as e:
                self.logger.error(f"Stream error: {e}")
                return jsonify({'error': str(e)}), 500
        
        @self.app.route('/api/logs')
        def api_logs():
            """Отримати системні логи"""
            try:
                # Тут можна читати логи з файлу або кешу
                logs = self._get_recent_logs()
                return jsonify({
                    'logs': logs,
                    'timestamp': time.time(),
                    'count': len(logs)
                })
            except Exception as e:
                self.logger.error(f"Logs error: {e}")
                return jsonify({'error': str(e)}), 500
    
    def _process_message(self, message, response_id):
        """Обробляємо повідомлення в окремому потоці"""
        try:
            # Повідомляємо про початок обробки
            self.response_queue.put({
                'type': 'start',
                'message': 'Обробляю повідомлення...',
                'response_id': response_id,
                'timestamp': time.time()
            })
            
            # Викликаємо Atlas Core
            if self.atlas_core and hasattr(self.atlas_core, 'process_message'):
                # Створюємо callback для стрімінгу
                def stream_callback(chunk):
                    self.response_queue.put({
                        'type': 'chunk',
                        'content': chunk,
                        'response_id': response_id,
                        'timestamp': time.time()
                    })
                
                # Обробляємо повідомлення
                response = self.atlas_core.process_message(message, stream_callback)
                
                # Завершуємо стрім
                self.response_queue.put({
                    'type': 'complete',
                    'message': 'Відповідь завершена',
                    'response_id': response_id,
                    'timestamp': time.time(),
                    'final_response': response if isinstance(response, str) else None
                })
            else:
                # Заглушка якщо Atlas Core не готовий
                self.response_queue.put({
                    'type': 'chunk',
                    'content': f"Отримав повідомлення: {message}",
                    'response_id': response_id,
                    'timestamp': time.time()
                })
                
                self.response_queue.put({
                    'type': 'complete',
                    'message': 'Тестова відповідь завершена',
                    'response_id': response_id,
                    'timestamp': time.time()
                })
                
        except Exception as e:
            self.logger.error(f"Message processing error: {e}")
            self.response_queue.put({
                'type': 'error',
                'error': str(e),
                'response_id': response_id,
                'timestamp': time.time()
            })
    
    def _get_recent_logs(self, limit=100):
        """Отримуємо нещодавні логи"""
        try:
            # Тут можна читати з log файлу
            # Поки що повертаємо заглушку
            return [
                {
                    'timestamp': time.time() - 60,
                    'level': 'INFO',
                    'source': 'system',
                    'message': 'Atlas API initialized'
                },
                {
                    'timestamp': time.time() - 30,
                    'level': 'INFO',
                    'source': 'core',
                    'message': 'Atlas Core ready'
                }
            ]
        except Exception:
            return []
    
    def set_start_time(self, start_time):
        """Встановлюємо час запуску"""
        self.start_time = start_time
