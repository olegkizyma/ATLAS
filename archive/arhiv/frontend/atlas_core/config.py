import os
from pathlib import Path

# Simple .env loader (no external deps). Reads frontend/.env.local first, then frontend/.env
_LOCAL_ENV = None


def _load_local_env() -> dict:
    global _LOCAL_ENV
    if _LOCAL_ENV is not None:
        return _LOCAL_ENV
    env: dict[str, str] = {}
    # Locate frontend folder from this file: atlas_core/ -> parent is frontend
    base = Path(__file__).resolve().parents[1]
    for name in (".env.local", ".env"):
        p = base / name
        if p.exists():
            try:
                with p.open("r", encoding="utf-8") as f:
                    for line in f:
                        s = line.strip()
                        if not s or s.startswith('#') or '=' not in s:
                            continue
                        k, v = s.split('=', 1)
                        env[k.strip()] = v.strip()
            except Exception:
                # Ignore parse errors silently to avoid breaking runtime
                pass
    _LOCAL_ENV = env
    return _LOCAL_ENV


def _is_truthy(val: str | None) -> bool:
    return str(val).lower() in ("1", "true", "yes", "on") if val is not None else False


def _get(key: str, default: str | None = None) -> str | None:
    env = _load_local_env()
    # STRICT_LOCAL_ENV=1 -> only values from local .env files
    strict = _is_truthy(env.get('STRICT_LOCAL_ENV'))
    if key in env:
        return env[key]
    if strict:
        return default
    return os.getenv(key, default)


def gemini_api_key() -> str | None:
    return _get('GEMINI_API_KEY')


def gemini_model(default: str = 'gemini-2.0-flash') -> str:
    return _get('GEMINI_MODEL', default) or default


def gemini_base_url(default: str = 'https://generativelanguage.googleapis.com/v1beta') -> str:
    return _get('GEMINI_BASE_URL', default) or default


def mistral_api_key() -> str | None:
    return _get('MISTRAL_API_KEY')


def mistral_model(default: str = 'mistral-small-latest') -> str:
    return _get('MISTRAL_MODEL', default) or default


def goose_api_url(default: str | None = None) -> str | None:
    return _get('GOOSE_API_URL', default)


def goose_secret_key(default: str = 'test') -> str:
    return _get('GOOSE_SECRET_KEY', default) or default


def goose_workdir(default: str | None = None) -> str | None:
    return _get('GOOSE_WORKDIR', default)


def atlas_core_url(default: str = 'http://127.0.0.1:8000') -> str:
    return _get('ATLAS_CORE_URL', default) or default


def disable_cli_fallback() -> bool:
    """Флаг для строгих окружений: запрещать переход на CLI.

    ATLAS_DISABLE_CLI_FALLBACK: "1"/"true"/"True" => True
    """
    val = _get('ATLAS_DISABLE_CLI_FALLBACK', '0')
    return _is_truthy(val)

# Дополнительно: глобальный флаг строгого локального режима (для отладки/локального запуска)
def strict_local_env() -> bool:
    env = _load_local_env()
    return _is_truthy(env.get('STRICT_LOCAL_ENV'))
