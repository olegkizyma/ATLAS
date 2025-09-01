import logging
from typing import Tuple, Optional, Literal
import requests
from services import config as cfg

logger = logging.getLogger(__name__)

Agent = Literal["atlas", "goose", "grisha"]
Provider = Literal["gemini", "google", "local"]


class TTSService:
    """Уніфікований TTS сервіс з підтримкою кількох провайдерів і голосів по агентам.

    Провайдери:
      - "gemini"/"google": проксування через Atlas Core /tts (використовує зовнішні ключі там)
      - "local": локальний український TTS HTTP сервер (ukrainian-tts)
    """

    def __init__(self):
        self.atlas_core_url = cfg.atlas_core_url()
        self.ukr_tts_url = cfg.ukrainian_tts_url()

    def _select(self, agent: Agent, override_provider: Optional[str], override_voice: Optional[str]) -> Tuple[Provider, str]:
        prov: Provider
        if override_provider:
            prov = "local" if override_provider.lower() in ("local", "ukrainian", "ua") else ("gemini" if override_provider.lower() in ("gemini",) else "google")
        else:
            prov = cfg.tts_provider_for(agent)
        voice = override_voice or cfg.tts_voice_for(agent)
        return prov, voice

    def speak(self, text: str, agent: Agent = "atlas", provider: Optional[str] = None, voice: Optional[str] = None) -> dict:
        provider_final, voice_final = self._select(agent, provider, voice)
        try:
            if provider_final in ("gemini", "google"):
                return self._via_atlas_core(text, voice_final)
            else:
                return self._via_local_ukrainian(text, voice_final)
        except Exception as e:
            logger.error(f"TTSService error: {e}")
            return {"success": False, "error": str(e)}

    def _via_atlas_core(self, text: str, voice: str) -> dict:
        url = f"{self.atlas_core_url}/tts"
        payload = {"text": text, "voice": voice}
        r = requests.post(url, json=payload, timeout=20)
        if r.status_code == 200:
            try:
                data = r.json()
            except Exception:
                data = {"status": "ok"}
            return {"success": True, "provider": "atlas_core", "voice": voice, "response": data}
        return {"success": False, "error": f"HTTP {r.status_code}", "response": r.text[:500]}

    def _via_local_ukrainian(self, text: str, voice: str) -> dict:
        base = self.ukr_tts_url.rstrip("/")
        # Пробуємо стандартний шлях /tts, якщо заданий URL без шляху – додаємо /tts
        url = base if base.endswith("/tts") or base.endswith("/speak") else f"{base}/tts"
        payload = {"text": text, "voice": voice}
        r = requests.post(url, json=payload, timeout=30)
        if r.status_code == 200:
            try:
                data = r.json()
            except Exception:
                data = {"status": "ok"}
            return {"success": True, "provider": "local", "voice": voice, "response": data}
        return {"success": False, "error": f"HTTP {r.status_code}", "response": r.text[:500]}
