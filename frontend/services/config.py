import os
from pathlib import Path


def get_env_bool(name: str, default: bool = False) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return str(val).lower() in ("1", "true", "yes", "y", "on")


def goose_base_url(default: str | None = None) -> str | None:
    return os.getenv("GOOSE_BASE_URL", default)


def goose_secret_key(default: str = "") -> str:
    return os.getenv("GOOSE_SECRET_KEY", default)


def stream_timeout_seconds(default: int | None = None) -> int | None:
    raw = (os.getenv("ATLAS_STREAM_TIMEOUT") or os.getenv("ATLAS_STREAM_TIMEOUT_SECONDS") or "").strip()
    if not raw:
        return default
    low = raw.lower()
    if low in ("0", "none", "off", "infinite"):
        return None
    try:
        return int(raw)
    except Exception:
        return default


def logs_file_path(default: str = "/tmp/goose.log") -> str:
    return os.getenv("GOOSE_LOG_FILE", default)


def sse_heartbeat_seconds(default: int = 30) -> int:
    try:
        return int(os.getenv("ATLAS_SSE_HEARTBEAT", str(default)))
    except Exception:
        return default
