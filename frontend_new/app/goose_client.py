import json
import time
import os
import requests
import aiohttp
import asyncio

class GooseClient:
    """Клієнт для взаємодії з Goose (web/ws або goosed /reply SSE)."""

    def __init__(self, base_url: str | None = None, secret_key: str | None = None):
        # Порядок пріоритетів: аргумент -> env -> авто-вибір
        env_url = os.getenv('GOOSE_BASE_URL')
        self.base_url = base_url or env_url or self._auto_pick_goose_url()
        self.secret_key = secret_key or os.getenv('GOOSE_SECRET_KEY', 'test')

    def _auto_pick_goose_url(self) -> str:
        # Спочатку перевіряємо goose web на стандартному порті 3000
        try:
            r = requests.get("http://127.0.0.1:3000/", timeout=2)
            if r.status_code == 200 and "Goose Chat" in r.text:
                print("🌐 Знайдено Goose Web на порті 3000")
                return "http://127.0.0.1:3000"
        except Exception:
            pass
            
        # Потім перевіряємо goosed API
        for base in ("http://127.0.0.1:3000", "http://127.0.0.1:3001"):
            for ep in ("/status", "/api/health", "/"):
                try:
                    r = requests.get(f"{base}{ep}", timeout=2)
                    if r.status_code in (200, 404):
                        return base
                except Exception:
                    continue
        return "http://127.0.0.1:3000"

    def _is_web(self) -> bool:
        try:
            # Перевіряємо чи це goose web (завжди на 3000 порту)
            r = requests.get(f"{self.base_url}/", timeout=3)
            return r.status_code == 200 and "Goose Chat" in r.text
        except Exception:
            return False

    def _is_goosed(self) -> bool:
        try:
            r = requests.get(f"{self.base_url}/status", timeout=3)
            return r.status_code == 200
        except Exception:
            return False

    def send_reply(self, session_name: str, message: str, timeout: int = 90) -> dict:
        if self._is_web():
            try:
                return asyncio.run(self._via_ws(session_name, message, timeout))
            except RuntimeError:
                loop = asyncio.new_event_loop()
                try:
                    asyncio.set_event_loop(loop)
                    return loop.run_until_complete(self._via_ws(session_name, message, timeout))
                finally:
                    asyncio.set_event_loop(None)
                    loop.close()
        return self._via_sse(session_name, message, timeout)

    async def _via_ws(self, session_name: str, message: str, timeout: int):
        ws_url = self.base_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws"
        payload = {"type": "message", "content": message, "session_id": session_name, "timestamp": int(time.time()*1000)}
        chunks = []
        timeout_total = aiohttp.ClientTimeout(total=timeout)
        async with aiohttp.ClientSession(timeout=timeout_total) as session:
            async with session.ws_connect(ws_url, heartbeat=30) as ws:
                await ws.send_str(json.dumps(payload))
                async for msg in ws:
                    if msg.type == aiohttp.WSMsgType.TEXT:
                        try:
                            obj = json.loads(msg.data)
                        except Exception:
                            obj = None
                        if isinstance(obj, dict):
                            t = obj.get("type")
                            if t == "response":
                                content = obj.get("content")
                                if content:
                                    chunks.append(str(content))
                            elif t in ("complete", "cancelled"):
                                break
                            elif t == "error":
                                return {"success": False, "error": obj.get("message", "websocket error")}
                        else:
                            chunks.append(str(msg.data))
                    elif msg.type in (aiohttp.WSMsgType.CLOSE, aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                        break
        return {"success": True, "response": "".join(chunks).strip()}

    def _via_sse(self, session_name: str, message: str, timeout: int):
        url = f"{self.base_url}/reply"
        headers = {"Accept": "text/event-stream", "Cache-Control": "no-cache", "X-Secret-Key": self.secret_key}
        payload = {
            "messages": [{"role": "user", "created": int(time.time()), "content": [{"type": "text", "text": message}]}],
            "session_id": session_name,
            "session_working_dir": os.getcwd(),
        }
        with requests.post(url, json=payload, headers=headers, stream=True, timeout=timeout) as resp:
            if resp.status_code != 200:
                try:
                    text = resp.text[:500]
                except Exception:
                    text = "<no body>"
                return {"success": False, "error": f"HTTP {resp.status_code}", "response": text}
            chunks = []
            for raw_line in resp.iter_lines(decode_unicode=True):
                if raw_line is None:
                    continue
                line = raw_line.strip()
                if not line or line.startswith(":"):
                    continue
                if line.startswith("data:"):
                    data_part = line[5:].lstrip()
                    try:
                        obj = json.loads(data_part)
                        if isinstance(obj, dict):
                            if obj.get("type") == "Message" and isinstance(obj.get("message"), dict):
                                msg = obj["message"]
                                for c in msg.get("content", []) or []:
                                    if isinstance(c, dict) and c.get("type") == "text":
                                        t = c.get("text")
                                        if t:
                                            chunks.append(str(t))
                            else:
                                token = obj.get("text") or obj.get("token") or obj.get("content")
                                if token:
                                    chunks.append(str(token))
                                if obj.get("final") is True or obj.get("done") is True:
                                    break
                        else:
                            chunks.append(str(obj))
                    except Exception:
                        chunks.append(data_part)
                elif line.lower() == "event: done":
                    break
        return {"success": True, "response": "".join(chunks).strip()}
