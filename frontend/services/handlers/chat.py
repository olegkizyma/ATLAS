import json
import logging
from datetime import datetime

from services.chat_stream import ChatStreamer
from services.utils.session import (
    determine_session_type as util_determine_session_type,
    get_session_name as util_get_session_name,
)

logger = logging.getLogger(__name__)

def handle_chat(h):
    """Non-stream chat. Пока вызываем существующий метод обработчика, чтобы избежать дублирования.
    Позже можно вынести бизнес-логику сюда полностью.
    """
    return h.handle_chat()

def handle_chat_stream(h):
    try:
        content_length = int(h.headers.get('Content-Length', 0))
        post_data = h.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8')) if post_data else {}

        user_message = data.get("message") or data.get("prompt")
        if not user_message:
            _send_error_response(h, 400, "Message is required")
            return

        session_type = util_determine_session_type(user_message, data.get("session_type"))
        session_name = data.get("session_name") or util_get_session_name(user_message, session_type)

        h.send_response(200)
        h.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        h.send_header('Cache-Control', 'no-cache')
        h.send_header('Connection', 'keep-alive')
        h.send_header('Access-Control-Allow-Origin', '*')
        h.end_headers()

        streamer = ChatStreamer(h.goose_client)
        try:
            for event in streamer.stream({
                "message": user_message,
                "session_type": session_type,
                "session_name": session_name,
                "no_paraphrase": False,
            }, goose_base_url=h.goose_api_url):
                payload = json.dumps(event, ensure_ascii=False)
                h.wfile.write(f"data: {payload}\n\n".encode('utf-8'))
                try:
                    h.wfile.flush()
                except Exception:
                    pass
        except (BrokenPipeError, ConnectionResetError):
            return
    except Exception as e:
        logger.error(f"Fatal error in handle_chat_stream: {e}")
        _send_error_response(h, 500, str(e))


def _send_error_response(h, status_code: int, error_message: str):
    error_response = {
        "error": error_message,
        "status_code": status_code,
        "timestamp": datetime.now().isoformat(),
    }
    response = json.dumps(error_response, ensure_ascii=False).encode('utf-8')
    h.send_response(status_code)
    h.send_header('Content-type', 'application/json; charset=utf-8')
    h.send_header('Access-Control-Allow-Origin', '*')
    h.send_header('Content-Length', str(len(response)))
    h.end_headers()
    h.wfile.write(response)
