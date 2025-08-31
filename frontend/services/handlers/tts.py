import json
import logging

logger = logging.getLogger(__name__)

def handle_tts(h):
    try:
        content_length = int(h.headers.get('Content-Length', 0))
        post_data = h.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))
        text = data.get("text", "")
        if not text:
            _send_json(h, {"error": "Text is required"}, 400)
            return
        if getattr(h, 'live_streamer', None):
            try:
                h.live_streamer._add_log(f"[TTS] Request: {text[:30]}...")
            except Exception:
                pass
        success = h.send_tts_request(text)
        if success:
            _send_json(h, {"status": "success"})
        else:
            _send_json(h, {"error": "TTS service unavailable"}, 503)
    except Exception as e:
        logger.error(f"TTS error: {e}")
        _send_json(h, {"error": str(e)}, 500)


def _send_json(h, obj: dict, status: int = 200):
    payload = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    h.send_response(status)
    h.send_header('Content-type', 'application/json; charset=utf-8')
    h.send_header('Content-Length', str(len(payload)))
    h.end_headers()
    h.wfile.write(payload)
