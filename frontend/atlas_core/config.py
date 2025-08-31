import os


def gemini_api_key() -> str | None:
    return os.getenv('GEMINI_API_KEY')


def gemini_model(default: str = 'gemini-2.0-flash') -> str:
    return os.getenv('GEMINI_MODEL', default)


def gemini_base_url(default: str = 'https://generativelanguage.googleapis.com/v1beta') -> str:
    return os.getenv('GEMINI_BASE_URL', default)


def mistral_api_key() -> str | None:
    return os.getenv('MISTRAL_API_KEY')


def goose_api_url(default: str | None = None) -> str | None:
    return os.getenv('GOOSE_API_URL', default)


def goose_secret_key(default: str = 'test') -> str:
    return os.getenv('GOOSE_SECRET_KEY', default)


def goose_workdir(default: str | None = None) -> str | None:
    return os.getenv('GOOSE_WORKDIR', default)


def atlas_core_url(default: str = 'http://127.0.0.1:8000') -> str:
    return os.getenv('ATLAS_CORE_URL', default)
