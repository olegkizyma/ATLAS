"""
HTTP utils with exponential backoff, jitter and small inter-call delay.
Used to stabilize calls to external LLM APIs (Gemini, Mistral).
"""

from __future__ import annotations

import os
import time
import random
from typing import Iterable, Optional

import requests


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except Exception:
        return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except Exception:
        return default


def post_json_with_retry(
    url: str,
    *,
    headers: Optional[dict] = None,
    json: Optional[dict] = None,
    timeout: float | int = 15,
    retries: Optional[int] = None,
    backoff_base: Optional[float] = None,
    backoff_max: Optional[float] = None,
    retry_on_status: Optional[Iterable[int]] = None,
    inter_call_delay: Optional[float] = None,
):
    """
    POST helper with JSON body, exponential backoff + jitter, and small inter-call delay.

    - Respects Retry-After header when present.
    - Retries on common transient status codes and network exceptions.
    - Raises for non-retryable HTTP errors to match requests.post usage.
    """

    # Defaults (env-overridable)
    max_retries = retries if retries is not None else _env_int("ATLAS_HTTP_MAX_RETRIES", 3)
    base = backoff_base if backoff_base is not None else _env_float("ATLAS_HTTP_BACKOFF_BASE", 0.5)
    cap = backoff_max if backoff_max is not None else _env_float("ATLAS_HTTP_BACKOFF_MAX", 4.0)
    delay = inter_call_delay if inter_call_delay is not None else _env_float("ATLAS_HTTP_INTERCALL_DELAY", 0.15)
    retry_statuses = set(retry_on_status or (429, 500, 502, 503, 504))

    # Optional small delay to avoid rapid-fire sequences
    if delay and delay > 0:
        # add light jitter 70%-130%
        time.sleep(delay * (0.7 + random.random() * 0.6))

    attempt = 0
    while True:
        try:
            resp = requests.post(url, headers=headers, json=json, timeout=timeout)

            # Successful fast-path
            if resp.status_code < 400:
                return resp

            # Retryable HTTP status codes
            if attempt < max_retries and resp.status_code in retry_statuses:
                # Honor Retry-After when provided
                ra = resp.headers.get("Retry-After")
                if ra is not None:
                    try:
                        sleep_s = float(ra)
                    except ValueError:
                        sleep_s = 0.0
                else:
                    sleep_s = min(cap, base * (2 ** attempt))
                    sleep_s *= (0.7 + random.random() * 0.6)  # jitter

                time.sleep(max(0.05, sleep_s))
                attempt += 1
                continue

            # Non-retryable HTTP errors: raise
            resp.raise_for_status()
            return resp  # pragma: no cover (raise above for >=400)

        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            if attempt < max_retries:
                sleep_s = min(cap, base * (2 ** attempt))
                sleep_s *= (0.7 + random.random() * 0.6)  # jitter
                time.sleep(max(0.05, sleep_s))
                attempt += 1
                continue
            # Exhausted retries
            raise e
