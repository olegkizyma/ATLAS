"""
Місце для майбутнього виділення HTTP-роутів/хендлерів у дрібні модулі.
Поки що лише заготовка.
"""

from http.server import SimpleHTTPRequestHandler

class RouteMixin:
    """Змішування з утилітними методами відповіді JSON."""

    def send_json_response(self, data, status=200):
        payload = (data if isinstance(data, (bytes, bytearray)) else (__import__('json').dumps(data, ensure_ascii=False).encode('utf-8')))
        self.send_response(status)
        self.send_header('Content-type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
