#!/usr/bin/env python3
"""
Minimal ATLAS Frontend Server 
Simple HTTP server for testing without external dependencies
"""

import http.server
import socketserver
import json
import urllib.parse
from pathlib import Path
import os

PORT = 5001
TEMPLATE_DIR = Path(__file__).parent / 'templates'
STATIC_DIR = Path(__file__).parent / 'static'

class AtlasHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR.parent), **kwargs)

    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            self.serve_index()
        elif self.path.startswith('/api/'):
            self.handle_api(self.path)
        elif self.path.startswith('/static/'):
            # Serve static files
            file_path = STATIC_DIR / self.path[8:]  # Remove '/static/'
            if file_path.exists():
                self.serve_file(file_path)
            else:
                self.send_error(404)
        else:
            super().do_GET()

    def do_POST(self):
        if self.path.startswith('/api/'):
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
            except:
                data = {}
            self.handle_api(self.path, data)
        else:
            self.send_error(405)

    def serve_index(self):
        try:
            with open(TEMPLATE_DIR / 'index.html', 'r', encoding='utf-8') as f:
                html_content = f.read()
            
            # Simple template replacement
            html_content = html_content.replace('{{ current_time }}', '12:00:00')
            html_content = html_content.replace('{{ url_for(\'static\', filename=\'', '/static/')
            html_content = html_content.replace('\') }}', '')
            
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(html_content.encode('utf-8'))
        except Exception as e:
            self.send_error(500, f"Template error: {e}")

    def serve_file(self, file_path):
        try:
            with open(file_path, 'rb') as f:
                content = f.read()
            
            content_type = self.guess_type(str(file_path))
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_error(500, f"File error: {e}")

    def handle_api(self, path, data=None):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

        if path == '/api/health':
            response = {
                'status': 'ok',
                'timestamp': '2024-09-04T12:00:00Z',
                'services': {
                    'frontend': 'running',
                    'orchestrator': 'stopped',
                    'tts': 'fallback'
                }
            }
        elif path == '/api/agents':
            response = {
                'atlas': {
                    'voice': 'dmytro',
                    'signature': '[ATLAS]',
                    'color': '#00ff00'
                },
                'tetyana': {
                    'voice': 'tetiana',
                    'signature': '[ТЕТЯНА]',
                    'color': '#00ffff'
                },
                'grisha': {
                    'voice': 'robot',
                    'signature': '[ГРИША]',
                    'color': '#ffff00'
                }
            }
        elif path == '/api/chat' and data:
            message = data.get('message', '')
            response = {
                'success': True,
                'response': [
                    {
                        'role': 'assistant',
                        'content': f'[ATLAS] Отримав повідомлення: {message}',
                        'agent': 'atlas',
                        'voice': 'dmytro',
                        'messageId': 'msg_' + str(hash(message))[:8]
                    },
                    {
                        'role': 'assistant', 
                        'content': f'[ГРИША] Перевіряю безпеку запиту про: {message}',
                        'agent': 'grisha',
                        'voice': 'robot',
                        'messageId': 'msg_' + str(hash(message + 'grisha'))[:8]
                    },
                    {
                        'role': 'assistant',
                        'content': f'[ТЕТЯНА] Готова виконувати завдання: {message}',
                        'agent': 'tetyana', 
                        'voice': 'tetiana',
                        'messageId': 'msg_' + str(hash(message + 'tetyana'))[:8]
                    }
                ]
            }
        elif path == '/api/voice/synthesize' and data:
            text = data.get('text', '')
            agent = data.get('agent', 'atlas')
            response = {
                'success': True,
                'fallback': True,
                'message': 'Using browser TTS',
                'text': text,
                'agent': agent,
                'voice': 'dmytro' if agent == 'atlas' else ('robot' if agent == 'grisha' else 'tetiana')
            }
        elif path == '/api/voice/interrupt' and data:
            transcript = data.get('transcript', '')
            response = {
                'success': True,
                'interruption_detected': True,
                'transcript': transcript,
                'action': 'interrupt',
                'response': {
                    'success': True,
                    'message': f'Interruption processed: {transcript}',
                    'shouldPause': True
                }
            }
        else:
            response = {'error': 'Not found'}
        
        self.wfile.write(json.dumps(response, ensure_ascii=False).encode('utf-8'))

if __name__ == '__main__':
    print(f"Starting ATLAS Frontend Server on port {PORT}")
    print(f"Template directory: {TEMPLATE_DIR}")
    print(f"Static directory: {STATIC_DIR}")
    
    with socketserver.TCPServer(("0.0.0.0", PORT), AtlasHandler) as httpd:
        print(f"Server running at http://localhost:{PORT}")
        print("Press Ctrl+C to stop")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped")