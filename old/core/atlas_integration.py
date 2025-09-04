"""
Local AtlasCore integration for ATLAS Frontend v2.0

This lightweight core delegates message processing to the Orchestrator
running on Node.js via streaming endpoint /chat/stream.

Purpose:
- Make frontend_new self-contained without depending on ../frontend/atlas_core
"""

from __future__ import annotations

import os
import json
import time
import logging
from typing import Callable, Optional

import requests


logger = logging.getLogger("atlas.core")


class AtlasCore:
    """Minimal AtlasCore that proxies to Orchestrator SSE stream.

    Methods:
      - process_message(message, stream_callback) -> str | None
      - cleanup() -> None
    """

    def __init__(self, orchestrator_base: Optional[str] = None, timeout: int = 90):
        self.orchestrator_base = (orchestrator_base or os.getenv("ORCH_BASE") or "http://127.0.0.1:5101").rstrip("/")
        self.timeout = timeout
        logger.info(f"AtlasCore initialized, using Orchestrator at {self.orchestrator_base}")

    def process_message(self, message: str, stream_callback: Optional[Callable[[str], None]] = None) -> Optional[str]:
        """Send message to Orchestrator streaming endpoint and optionally stream chunks back.

        Returns last assembled response text if available, else None.
        """
        url = f"{self.orchestrator_base}/chat/stream"
        headers = {
            "Accept": "text/event-stream",
            "Content-Type": "application/json",
        }
        payload = {"message": message}

        try:
            with requests.post(url, json=payload, headers=headers, stream=True, timeout=self.timeout) as resp:
                resp.raise_for_status()
                final_text: Optional[str] = None

                for raw_line in resp.iter_lines(decode_unicode=True):
                    if not raw_line:
                        continue
                    # Expect SSE lines starting with 'data: '
                    if isinstance(raw_line, bytes):
                        try:
                            raw_line = raw_line.decode("utf-8", errors="ignore")
                        except Exception:
                            continue

                    if not raw_line.startswith("data: "):
                        continue

                    data_str = raw_line[len("data: "):].strip()
                    try:
                        event = json.loads(data_str)
                    except Exception:
                        continue

                    etype = event.get("type")
                    if etype in ("chunk", "delta"):
                        content = event.get("content") or event.get("delta") or ""
                        if content and stream_callback:
                            try:
                                stream_callback(content)
                            except Exception as cb_err:
                                logger.warning(f"stream_callback error: {cb_err}")
                    elif etype == "complete":
                        # Some implementations provide final_response
                        final_text = event.get("final_response") or final_text
                        break
                    elif etype == "error":
                        logger.error(f"Orchestrator error: {event.get('error')}")
                        break

                return final_text

        except requests.HTTPError as he:
            logger.error(f"HTTP error from Orchestrator: {he}")
        except requests.RequestException as re:
            logger.error(f"Request error to Orchestrator: {re}")
        except Exception as e:
            logger.error(f"Unexpected error in process_message: {e}")

        # Fallback behaviour: echo short response
        return None

    def cleanup(self) -> None:
        """No-op for now, kept for API compatibility."""
        try:
            logger.info("AtlasCore cleanup: nothing to do")
        except Exception:
            pass
