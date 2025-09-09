#!/usr/bin/env python3
"""Mock health endpoint for testing"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import threading
import time
import sys

class HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/api/health':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {"status": "ok", "service": "atlas-mock", "timestamp": time.time()}
            self.wfile.write(json.dumps(response).encode())
        elif self.path == '/api/chat':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {"message": "Mock ATLAS response", "agent": "atlas", "timestamp": time.time()}
            self.wfile.write(json.dumps(response).encode())
        elif self.path == '/api/voice/prepare_response':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {"status": "prepared", "agent": "atlas", "timestamp": time.time()}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def do_POST(self):
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length)
        
        if self.path == '/api/chat':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {"message": "Mock ATLAS response", "agent": "atlas", "timestamp": time.time()}
            self.wfile.write(json.dumps(response).encode())
        elif self.path == '/api/voice/prepare_response':
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {"status": "prepared", "agent": "atlas", "timestamp": time.time()}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.end_headers()
    
    def log_message(self, format, *args):
        pass  # Suppress default logging

def start_mock_server(port=5001):
    try:
        server = HTTPServer(('127.0.0.1', port), HealthHandler)
        print(f"Mock health server starting on port {port}")
        server.serve_forever()
    except KeyboardInterrupt:
        print("Mock server stopped")
        server.shutdown()
    except Exception as e:
        print(f"Error starting mock server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    start_mock_server(port)