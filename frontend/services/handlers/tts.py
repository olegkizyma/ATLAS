import json
import logging
from services.tts_service import TTSService

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
        agent = (data.get("agent") or "atlas").lower()
        provider = data.get("provider")  # optional override
        voice = data.get("voice")
        svc = TTSService()
        result = svc.speak(text=text, agent=agent, provider=provider, voice=voice)
        if result.get("success"):
            _send_json(h, {"status": "success", **{k: v for k, v in result.items() if k != "success"}})
        else:
            _send_json(h, {"error": result.get("error", "TTS unavailable"), "details": result.get("response")}, 503)
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
