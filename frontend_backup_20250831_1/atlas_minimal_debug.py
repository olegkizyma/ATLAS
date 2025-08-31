#!/usr/bin/env python3
"""
Atlas Debug Server - Мінімальний сервер для діагностики
"""
import os
import sys
from pathlib import Path
from http.server import HTTPServer, SimpleHTTPRequestHandler
import json

class DebugHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            html = """<!DOCTYPE html>
<html>
<head><title>Atlas Debug</title></head>
<body>
<h1>Atlas Debug Server</h1>
<p>Server is working!</p>
<p>Path: {}</p>
<p>Time: {}</p>
</body>
</html>""".format(self.path, str(os.system('date')))
            self.wfile.write(html.encode())
        elif self.path == "/api/status":
            self.send_response(200)
            self.send_header('Content-type', 'application/json')
            self.end_headers()
            response = {"status": "ok", "server": "debug", "path": self.path}
            self.wfile.write(json.dumps(response).encode())
        else:
            self.send_response(404)
            self.send_header('Content-type', 'text/plain')
            self.end_headers()
            self.wfile.write(f"Path not found: {self.path}".encode())

def main():
    port = 8080
    server_address = ('', port)
    httpd = HTTPServer(server_address, DebugHandler)
    
    print(f"🚀 Debug server running on port {port}")
    print(f"📱 Test URL: http://localhost:{port}")
    
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n🛑 Server stopping...")
        httpd.shutdown()
        print("🛑 Server stopped")

if __name__ == "__main__":
    main()
