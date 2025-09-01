import json
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

def handle_analyze_prompt(h):
    try:
        content_length = int(h.headers.get('Content-Length', 0))
        post_data = h.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))
        prompt = data.get("prompt", "")
        if not prompt:
            _send_json(h, {"error": "Prompt is required"}, 400)
            return
        if hasattr(h.server, 'session_manager'):
            sm = h.server.session_manager
            analysis = sm.analyze_user_mode_preference(prompt)
            response_data = {
                "prompt": prompt,
                "analysis": analysis,
                "system_info": {
                    "current_default": "http_api" if sm.use_http_api else "cli",
                    "intelligent_switching": "enabled",
                },
                "timestamp": datetime.now().isoformat(),
            }
            _send_json(h, response_data)
        else:
            _send_json(h, {"error": "Session manager not available"}, 503)
    except Exception as e:
        logger.error(f"Prompt analysis error: {e}")
        _send_json(h, {"error": str(e)}, 500)


def _send_json(h, obj: dict, status: int = 200):
    payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    h.send_response(status)
    h.send_header('Content-type', 'application/json; charset=utf-8')
    h.send_header('Content-Length', str(len(payload)))
    h.end_headers()
    h.wfile.write(payload)
