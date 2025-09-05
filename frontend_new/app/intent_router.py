"""
Intent Router: prompt-based intent classification and casual reply generation
No keyword heuristics; uses LLM role/system prompts only.

Environment variables (optional):
- INTENT_LLM_BASE: OpenAI-compatible base URL (e.g., http://127.0.0.1:3010/v1)
- INTENT_LLM_MODEL: Model name (e.g., gpt-4o-mini). Default: 'gpt-4o-mini'
- INTENT_LLM_API_KEY: API key if required by the endpoint

If not configured or request errors happen, we default to intent='chat' and a
simple safe reply stub to avoid blocking the UX.
"""
from __future__ import annotations

import os
import json
from typing import Optional, List, Dict, Any

try:
    import requests  # type: ignore
except Exception:  # pragma: no cover
    requests = None


INTENT_SYSTEM_PROMPT = (
    "Ти — РОУТЕР НАМІРІВ. Лише КЛАСИФІКУЄШ намір користувача без виконання.\n"
    "Поверни РІВНО один JSON-об’єкт БЕЗ будь-якого оточуючого тексту.\n"
    "Поле intent ∈ {\"chat\", \"task\"}.\n"
    "chat — коли користувач просто спілкується/бесідує, без просьби щось виконати.\n"
    "task — коли користувач просить ВИКОНАТИ завдання/дію/інструкцію/розробку тощо.\n"
    "Формат: {\"intent\": \"chat|task\"}"
)

CASUAL_SYSTEM_PROMPT = (
    "Ти — Atlas, дружній співрозмовник. Твоє завдання — вести коротку та легку\n"
    "бесіду на будь-яку тему, ввічливо і доброзичливо. НЕ пропонуй виконувати\n"
    "завдання, НЕ ініціюй дії, НЕ проси підтверджень. Відповідь 1–2 речення.\n"
)


class LLMClient:
    def __init__(self,
                 base_url: Optional[str] = None,
                 model: Optional[str] = None,
                 api_key: Optional[str] = None,
                 timeout: int = 20):
        self.base_url = (base_url or os.environ.get('INTENT_LLM_BASE') or '').rstrip('/')
        self.model = model or os.environ.get('INTENT_LLM_MODEL') or 'gpt-4o-mini'
        self.api_key = api_key or os.environ.get('INTENT_LLM_API_KEY') or ''
        self.timeout = max(5, timeout)

    def is_configured(self) -> bool:
        return bool(self.base_url and requests)

    def chat(self, messages: List[Dict[str, str]]) -> Optional[str]:
        if not self.is_configured():
            return None
        url = f"{self.base_url}/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False
        }
        try:
            r = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
            if r.status_code != 200:
                return None
            data = r.json()
            text = data.get('choices', [{}])[0].get('message', {}).get('content')
            if isinstance(text, str) and text.strip():
                return text.strip()
            return None
        except Exception:
            return None


def classify_intent(user_text: str, client: Optional[LLMClient] = None) -> str:
    """Return 'chat' or 'task' using LLM-only prompt; defaults to 'chat' on failure."""
    client = client or LLMClient()
    messages = [
        {"role": "system", "content": INTENT_SYSTEM_PROMPT},
        {"role": "user", "content": user_text or ''}
    ]
    raw = client.chat(messages)
    if not raw:
        return 'chat'
    try:
        # Accept either pure JSON or JSON fenced in backticks
        s = raw.strip()
        if s.startswith('```'):
            s = s.strip('`')
            # might contain json\n prefix
            if s.lower().startswith('json'):
                s = s[4:]
        obj = json.loads(s)
        intent = str(obj.get('intent', 'chat')).lower()
        return 'task' if intent == 'task' else 'chat'
    except Exception:
        return 'chat'


def generate_casual_reply(user_text: str, client: Optional[LLMClient] = None) -> str:
    """Return short friendly reply using Atlas persona; fallback to safe echo."""
    client = client or LLMClient()
    messages = [
        {"role": "system", "content": CASUAL_SYSTEM_PROMPT},
        {"role": "user", "content": user_text or ''}
    ]
    out = client.chat(messages)
    if isinstance(out, str) and out.strip():
        return out.strip()
    # Safe fallback reply without triggering actions
    text = (user_text or '').strip()
    if not text:
        return "Привіт! Чим можу допомогти?"
    return f"Цікава думка. Можу підтримати розмову: {text}"

# Note: Heuristic keyword-based router was intentionally removed.
# This module now relies solely on LLM prompts (classify_intent, generate_casual_reply).
