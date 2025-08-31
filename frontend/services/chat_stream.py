import json
import time
import os
import requests
from services import config as cfg
from typing import Callable, Optional

from .goose_client import GooseClient
from prompts import build_directive

class ChatStreamer:
    """Выделенный стример для чата: SSE-ответы и логика раннего довыполнения.

    Использование:
      streamer = ChatStreamer(GooseClient())
      for event in streamer.stream(message, session_name, session_type, paraphrase=True):
          yield event  # dict
    """

    def __init__(self, goose: Optional[GooseClient] = None):
        self.goose = goose or GooseClient()

    def _should_paraphrase(self, payload: dict) -> bool:
        try:
            if isinstance(payload, dict) and str(payload.get("no_paraphrase", "")).lower() in ("1", "true", "yes"):
                return False
        except Exception:
            pass
        return os.getenv("ATLAS_PARAPHRASE", "1") not in ("0", "false", "False")

    def _paraphrase(self, user_message: str) -> str:
        return build_directive(user_message)

    def stream(self, payload: dict, goose_base_url: str | None = None):
        """Генерирует последовательность событий для SSE на основе входного payload.
        Ожидаются ключи: message|prompt, session_name?, session_type?
        """
        user_message = payload.get("message") or payload.get("prompt") or ""
        if not user_message:
            yield {"type": "error", "error": "Message is required"}
            return

        session_type = payload.get("session_type") or "task"
        session_name = payload.get("session_name") or self._default_session_name(user_message, session_type)
        use_paraphrase = self._should_paraphrase(payload)
        if session_type == "chat":
            use_paraphrase = False
        message_to_send = self._paraphrase(user_message) if use_paraphrase else user_message

        yield {"type": "status", "message": "connected", "session": session_name, "paraphrase": use_paraphrase}
        if session_type == "chat":
            yield {"type": "status", "role": "atlas", "event": "mode_detected", "mode": "chat", "say": "Режим — чат."}
        if use_paraphrase and message_to_send != user_message:
            yield {"type": "status", "role": "atlas", "event": "paraphrase", "say": "Перефразую для виконання:", "content": message_to_send}

        # Пряма прокладка стріму через Goose SSE (/reply) як простой базовый путь
        client = self.goose
        base_url = goose_base_url or client.base_url
        url = f"{base_url}/reply"
        headers = {"Accept": "text/event-stream", "Cache-Control": "no-cache", "X-Secret-Key": client.secret_key}
        payload_req = {
            "messages": [{"role": "user", "created": int(time.time()), "content": [{"type": "text", "text": message_to_send}]}],
            "session_id": session_name,
            "session_working_dir": os.getcwd(),
        }
        with requests.post(url, json=payload_req, headers=headers, stream=True, timeout=cfg.stream_timeout_seconds()) as resp:
            if resp.status_code != 200:
                try:
                    body = resp.text[:500]
                except Exception:
                    body = "<no body>"
                yield {"type": "error", "error": f"HTTP {resp.status_code}", "response": body}
                return
            accumulated = []
            for raw_line in resp.iter_lines(decode_unicode=True):
                if raw_line is None:
                    continue
                line = raw_line.strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data:"):
                    data_part = line[5:].lstrip()
                    token = None
                    is_done = False
                    try:
                        obj = json.loads(data_part)
                        if isinstance(obj, dict):
                            if obj.get("type") == "Message" and isinstance(obj.get("message"), dict):
                                msg = obj["message"]
                                for c in msg.get("content", []) or []:
                                    if isinstance(c, dict) and c.get("type") == "text":
                                        t = c.get("text")
                                        if t:
                                            token = str(t)
                                            accumulated.append(token)
                                            yield {"type": "token", "token": token, "accumulated": "".join(accumulated)}
                            else:
                                token = obj.get("text") or obj.get("token") or obj.get("content")
                                if token:
                                    token = str(token)
                                    accumulated.append(token)
                                    yield {"type": "token", "token": token, "accumulated": "".join(accumulated)}
                                if obj.get("final") is True or obj.get("done") is True:
                                    is_done = True
                        else:
                            token = str(obj)
                            accumulated.append(token)
                            yield {"type": "token", "token": token, "accumulated": "".join(accumulated)}
                    except Exception:
                        token = data_part
                        accumulated.append(token)
                        yield {"type": "token", "token": token, "accumulated": "".join(accumulated)}
                elif line.lower() == "event: done":
                    is_done = True
                if is_done:
                    break
            yield {"type": "done", "total": "".join(accumulated)}

    def _default_session_name(self, message: str, session_type: str) -> str:
        base = "chat" if session_type == "chat" else "task"
        return f"{base}_{int(time.time())}"

    def _stream_timeout(self) -> int | None:
        # Deprecated: use cfg.stream_timeout_seconds() externally
        return cfg.stream_timeout_seconds()
