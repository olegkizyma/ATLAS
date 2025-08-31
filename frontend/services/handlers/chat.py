import json
import logging
from datetime import datetime
import requests
import time
import os

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


def handle_goose_reply_proxy(h):
    """SSE-проксі до Goose /reply без трансформації подій (ідентично порту 3000).
    Приймає { message, session_type?, session_name? } і транслює сирі SSE-лінії клієнту.
    """
    try:
        content_length = int(h.headers.get('Content-Length', 0))
        post_data = h.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8')) if post_data else {}

        user_message = data.get("message") or data.get("prompt")
        if not user_message:
            _send_error_response(h, 400, "Message is required")
            return

        # Параметри сесії
        session_type = util_determine_session_type(user_message, data.get("session_type"))
        session_name = data.get("session_name") or util_get_session_name(user_message, session_type)

        # Відповідь як text/event-stream
        h.send_response(200)
        h.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        h.send_header('Cache-Control', 'no-cache')
        h.send_header('Connection', 'keep-alive')
        h.send_header('Access-Control-Allow-Origin', '*')
        h.end_headers()

        goose_base = getattr(h, 'goose_api_url', None) or h.goose_client.base_url
        # Визначаємо правильний шлях: для Goose Web -> /api/chat/reply, для goosed -> /reply
        try:
            is_web = h.goose_client._is_web()
        except Exception:
            is_web = False
        reply_path = "/api/chat/reply" if is_web else "/reply"
        secret = getattr(h.goose_client, 'secret_key', '') or ''
        headers = {
            "Accept": "text/event-stream",
            "Cache-Control": "no-cache",
        }
        if secret:
            headers["X-Secret-Key"] = secret
            headers["Authorization"] = f"Bearer {secret}"
        payload_req = {
            "messages": [{
                "role": "user",
                "created": int(time.time()),
                "content": [{"type": "text", "text": user_message}],
            }],
            "session_id": session_name,
            "session_working_dir": os.getcwd(),
        }
        timeout =  h.server.session_manager.stream_timeout_seconds() if hasattr(getattr(h, 'server', None), 'session_manager') else None
        if timeout is None:
            try:
                from services import config as cfg
                timeout = cfg.stream_timeout_seconds() or 90
            except Exception:
                timeout = 90

        # Проксируем сырой SSE-ответ без трансформации
        with requests.post(
            f"{goose_base}{reply_path}",
            json=payload_req,
            headers=headers,
            stream=True,
            timeout=timeout,
        ) as resp:
            if resp.status_code != 200:
                try:
                    body = resp.text[:500]
                except Exception:
                    body = "<no body>"
                # Повертаємо помилку у вигляді звичайного JSON (вже не SSE)
                _send_error_response(h, resp.status_code, f"Goose HTTP {resp.status_code}: {body}")
                return

            for raw_line in resp.iter_lines(decode_unicode=True):
                if raw_line is None:
                    continue
                try:
                    h.wfile.write((raw_line + "\n").encode('utf-8'))
                    # Клієнт очікує розділювач подій, iter_lines вже віддає порожні строки при \n\n
                    try:
                        h.wfile.flush()
                    except Exception:
                        pass
                except Exception:
                    break
    except Exception as e:
        logger.error(f"Fatal error in handle_goose_reply_proxy: {e}")
        try:
            _send_error_response(h, 500, str(e))
        except Exception:
            pass


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
