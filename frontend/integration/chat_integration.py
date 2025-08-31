#!/usr/bin/env python3
"""
Atlas Chat Integration Module
Модуль для інтеграції TutorialChat з системою Atlas
"""

import json
import logging
import os
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

from services.goose_client import GooseClient
from services import config as cfg
from services.chat_stream import ChatStreamer

logger = logging.getLogger(__name__)

class AtlasChatIntegration:
    """
    Клас для інтеграції TutorialChat з Atlas системою
    Забезпечує сумісність між API Atlas та TutorialChat компонентами
    """
    
    def __init__(self):
        self.goose_client = GooseClient(
            base_url=cfg.goose_base_url(), 
            secret_key=cfg.goose_secret_key("test")
        )
        self.tutorial_chat_path = Path(__file__).parent.parent / "TutorialChat"
        self._setup_static_routes()
    
    def _setup_static_routes(self):
        """Налаштування статичних маршрутів для TutorialChat"""
        self.static_files = {
            "/tutorialchat": str(self.tutorial_chat_path),
            "/tutorialchat/components": str(self.tutorial_chat_path / "components"),
            "/tutorialchat/api": str(self.tutorial_chat_path / "api"),
            "/tutorialchat/hooks": str(self.tutorial_chat_path / "hooks"),
            "/tutorialchat/contexts": str(self.tutorial_chat_path / "contexts"),
        }
    
    def handle_tutorial_chat_api(self, handler, path: str):
        """
        Обробляє API запити для TutorialChat
        Забезпечує сумісність між Atlas API та TutorialChat очікуваннями
        """
        if path.startswith("/api/chat/reply"):
            return self._handle_chat_reply(handler)
        elif path.startswith("/api/session"):
            return self._handle_session_api(handler)
        elif path.startswith("/api/message"):
            return self._handle_message_api(handler)
        else:
            handler.send_error(404, "TutorialChat API endpoint not found")
    
    def _handle_chat_reply(self, handler):
        """
        Обробляє /api/chat/reply - головний endpoint для чату
        Адаптує Atlas API до формату TutorialChat
        """
        try:
            content_length = int(handler.headers.get('Content-Length', 0))
            post_data = handler.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8')) if post_data else {}
            
            # Адаптуємо запит до формату Atlas
            atlas_request = self._adapt_tutorialchat_to_atlas(data)
            
            # Налаштування SSE відповіді
            handler.send_response(200)
            handler.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            handler.send_header('Cache-Control', 'no-cache')
            handler.send_header('Connection', 'keep-alive')
            handler.send_header('Access-Control-Allow-Origin', '*')
            handler.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            handler.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
            handler.end_headers()
            
            # Використовуємо ChatStreamer для потокової передачі
            streamer = ChatStreamer(self.goose_client)
            
            for event in streamer.stream(atlas_request, goose_base_url=self.goose_client.base_url):
                # Адаптуємо відповідь до формату TutorialChat
                tutorialchat_event = self._adapt_atlas_to_tutorialchat(event)
                payload = json.dumps(tutorialchat_event, ensure_ascii=False)
                handler.wfile.write(f"data: {payload}\n\n".encode('utf-8'))
                handler.wfile.flush()
            
            # Кінець потоку
            handler.wfile.write("data: [DONE]\n\n".encode('utf-8'))
            
        except Exception as e:
            logger.error(f"Помилка в _handle_chat_reply: {e}")
            error_event = {
                "type": "Error",
                "error": str(e),
                "timestamp": datetime.now().isoformat()
            }
            payload = json.dumps(error_event, ensure_ascii=False)
            handler.wfile.write(f"data: {payload}\n\n".encode('utf-8'))
    
    def _adapt_tutorialchat_to_atlas(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Адаптує запит з TutorialChat формату до Atlas формату
        """
        # TutorialChat використовує різні поля, адаптуємо їх
        message_content = data.get('message') or data.get('content') or data.get('prompt')
        
        atlas_request = {
            "message": message_content,
            "session_name": data.get('session_name', f'tutorialchat_{int(datetime.now().timestamp())}'),
            "session_type": data.get('session_type', 'chat'),
            "no_paraphrase": data.get('no_paraphrase', False),
            "model": data.get('model'),
            "temperature": data.get('temperature'),
            "max_tokens": data.get('max_tokens'),
        }
        
        # Додаємо метадані для TutorialChat
        atlas_request["tutorial_chat_metadata"] = {
            "original_request": data,
            "integration_version": "1.0.0",
            "timestamp": datetime.now().isoformat()
        }
        
        return atlas_request
    
    def _adapt_atlas_to_tutorialchat(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """
        Адаптує відповідь з Atlas формату до TutorialChat формату
        """
        # TutorialChat очікує специфічні типи подій
        event_type = event.get('type', 'message')
        
        tutorialchat_event = {
            "id": event.get('id', f"event_{int(datetime.now().timestamp())}"),
            "type": event_type,
            "timestamp": event.get('timestamp', datetime.now().isoformat())
        }
        
        # Адаптуємо різні типи подій
        if event_type == 'message' or event_type == 'Message':
            tutorialchat_event.update({
                "message": {
                    "id": event.get('message', {}).get('id', f"msg_{int(datetime.now().timestamp())}"),
                    "role": event.get('message', {}).get('role', 'assistant'),
                    "content": event.get('message', {}).get('content', event.get('content', '')),
                    "timestamp": datetime.now().isoformat()
                }
            })
        
        elif event_type == 'error' or event_type == 'Error':
            tutorialchat_event.update({
                "error": event.get('error', 'Unknown error'),
                "details": event.get('details')
            })
        
        elif event_type == 'finish' or event_type == 'Finish':
            tutorialchat_event.update({
                "reason": event.get('reason', 'completed'),
                "metadata": event.get('metadata')
            })
        
        elif event_type == 'notification' or event_type == 'Notification':
            tutorialchat_event.update({
                "notification": {
                    "method": event.get('message', {}).get('method'),
                    "params": event.get('message', {}).get('params')
                }
            })
        
        return tutorialchat_event
    
    def _handle_session_api(self, handler):
        """Обробляє API сесій для TutorialChat"""
        # Реалізація API для управління сесіями
        path_parts = handler.path.split('/')
        
        if len(path_parts) > 3 and path_parts[3] == 'history':
            # GET /api/session/{session_id}/history
            session_id = path_parts[2] if len(path_parts) > 2 else None
            return self._get_session_history(handler, session_id)
        
        elif handler.command == 'POST':
            # POST /api/session - створити нову сесію
            return self._create_session(handler)
        
        else:
            handler.send_error(404, "Session API endpoint not found")
    
    def _handle_message_api(self, handler):
        """Обробляє API повідомлень для TutorialChat"""
        # Реалізація API для управління повідомленнями
        if handler.command == 'GET':
            return self._get_messages(handler)
        elif handler.command == 'POST':
            return self._send_message(handler)
        else:
            handler.send_error(405, "Method not allowed")
    
    def _get_session_history(self, handler, session_id: Optional[str]):
        """Отримує історію сесії"""
        try:
            # Використовуємо Goose API для отримання історії
            if session_id:
                # Тут можна додати логіку отримання історії з Goose
                history = []  # Placeholder
            else:
                history = []
            
            response = {
                "session_id": session_id,
                "messages": history,
                "metadata": {
                    "timestamp": datetime.now().isoformat(),
                    "source": "atlas_integration"
                }
            }
            
            handler.send_response(200)
            handler.send_header('Content-Type', 'application/json')
            handler.send_header('Access-Control-Allow-Origin', '*')
            handler.end_headers()
            
            handler.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            
        except Exception as e:
            logger.error(f"Помилка в _get_session_history: {e}")
            handler.send_error(500, f"Internal server error: {e}")
    
    def _create_session(self, handler):
        """Створює нову сесію"""
        try:
            content_length = int(handler.headers.get('Content-Length', 0))
            post_data = handler.rfile.read(content_length)
            data = json.loads(post_data.decode('utf-8')) if post_data else {}
            
            session_id = f"tutorial_{int(datetime.now().timestamp())}"
            
            response = {
                "session_id": session_id,
                "created_at": datetime.now().isoformat(),
                "status": "active",
                "metadata": data.get('metadata', {})
            }
            
            handler.send_response(201)
            handler.send_header('Content-Type', 'application/json')
            handler.send_header('Access-Control-Allow-Origin', '*')
            handler.end_headers()
            
            handler.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))
            
        except Exception as e:
            logger.error(f"Помилка в _create_session: {e}")
            handler.send_error(500, f"Internal server error: {e}")
    
    def get_tutorial_chat_config(self) -> Dict[str, Any]:
        """
        Повертає конфігурацію для TutorialChat
        """
        return {
            "api_base_url": "/api",
            "websocket_url": "/ws",
            "streaming_enabled": True,
            "session_management": True,
            "tool_calls_enabled": True,
            "file_upload_enabled": False,  # Поки що вимкнено
            "max_message_length": 4000,
            "supported_formats": ["text", "markdown"],
            "integration_metadata": {
                "version": "1.0.0",
                "atlas_compatible": True,
                "goose_integration": True
            }
        }
    
    def serve_tutorial_chat_static(self, handler, path: str):
        """
        Обслуговує статичні файли TutorialChat
        """
        # Видаляємо /tutorialchat з початку шляху
        clean_path = path.replace('/tutorialchat', '', 1)
        if clean_path.startswith('/'):
            clean_path = clean_path[1:]
        
        file_path = self.tutorial_chat_path / clean_path
        
        if file_path.exists() and file_path.is_file():
            # Визначаємо content type
            content_type = self._get_content_type(file_path.suffix)
            
            handler.send_response(200)
            handler.send_header('Content-Type', content_type)
            handler.send_header('Access-Control-Allow-Origin', '*')
            handler.end_headers()
            
            with open(file_path, 'rb') as f:
                handler.wfile.write(f.read())
        else:
            handler.send_error(404, f"File not found: {clean_path}")
    
    def _get_content_type(self, suffix: str) -> str:
        """Визначає content type за розширенням файлу"""
        content_types = {
            '.js': 'application/javascript',
            '.jsx': 'application/javascript',
            '.ts': 'application/typescript',
            '.tsx': 'application/typescript',
            '.json': 'application/json',
            '.css': 'text/css',
            '.html': 'text/html',
            '.md': 'text/markdown',
            '.txt': 'text/plain',
        }
        return content_types.get(suffix.lower(), 'text/plain')


# Глобальний екземпляр інтеграції
chat_integration = AtlasChatIntegration()


def setup_tutorialchat_integration(handler_class):
    """
    Налаштовує інтеграцію TutorialChat для обробника запитів
    """
    original_do_GET = handler_class.do_GET
    original_do_POST = handler_class.do_POST
    original_do_OPTIONS = handler_class.do_OPTIONS
    
    def enhanced_do_GET(self):
        if self.path.startswith('/tutorialchat'):
            return chat_integration.serve_tutorial_chat_static(self, self.path)
        elif self.path.startswith('/api/tutorialchat/config'):
            config = chat_integration.get_tutorial_chat_config()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps(config, ensure_ascii=False).encode('utf-8'))
            return
        else:
            return original_do_GET(self)
    
    def enhanced_do_POST(self):
        if self.path.startswith('/api/chat/reply') or self.path.startswith('/api/session') or self.path.startswith('/api/message'):
            return chat_integration.handle_tutorial_chat_api(self, self.path)
        else:
            return original_do_POST(self)
    
    def enhanced_do_OPTIONS(self):
        if self.path.startswith('/api/'):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            self.end_headers()
            return
        else:
            return original_do_OPTIONS(self)
    
    handler_class.do_GET = enhanced_do_GET
    handler_class.do_POST = enhanced_do_POST
    handler_class.do_OPTIONS = enhanced_do_OPTIONS
    
    return handler_class
