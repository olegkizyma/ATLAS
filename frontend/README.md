# ATLAS Frontend (Minimal Server)

Мінімалістичний серверний фронтенд для Atlas з модульною архітектурою, SSE-стрімінгом і інтеграцією з Atlas Core та Goose.

## � Що всередині
- Один Python-сервер: `atlas_minimal_live.py` (Threading HTTP + CORS)
- Модулі в `services/`: клієнт Goose, стрім чату, стрім логів, TTS сервіс, конфіг
- Хендлери в `services/handlers/`: `/api/chat`, `/logs/stream`, `/api/tts/speak`, статус/атлас
- Централізований конфіг через `services/config.py`

## ✅ Вимоги
- macOS, Python 3.11+
- `pip` для встановлення залежностей (див. `requirements.txt`)

## 🚀 Швидкий старт
1) Скопіюйте приклад оточення та відредагуйте за потреби
	- `.env.example` → `.env`
	- Деталі змінних: `README.env.md`
2) Встановіть залежності: `./setup_env.sh` (або `pip install -r requirements.txt` у своєму venv)
3) Запустіть сервер: `./start_frontend.sh` (або `python3 frontend/atlas_minimal_live.py`)

За замовчуванням сервер слухає порт `ATLAS_PORT` (8080).

## ⚙️ Конфігурація (ключове)
Налаштовується через `.env` у папці `frontend/`:
- ATLAS_PORT — порт фронтенду (default: 8080)
- ATLAS_PARAPHRASE — перефразування промптів у task-режимі: 1/0 (default: 1)
- GOOSE_BASE_URL — базовий URL Goose (web/goosed). Якщо не задано — авто-підбір 3000/3001
- GOOSE_SECRET_KEY — X-Secret-Key для `/reply` (default: test)
- ATLAS_CORE_URL — URL Atlas Core (LLM/оркестрація/TTS-проксі), напр. http://127.0.0.1:8000
- UKRAINIAN_TTS_URL — локальний TTS HTTP endpoint, напр. http://127.0.0.1:3000/tts
- TTS_PROVIDER_DEFAULT — local | gemini | google (default: local)
- TTS_VOICE_DEFAULT — запасний голос (default: default)
- TTS_PROVIDER_{AGENT} / TTS_VOICE_{AGENT} — пер-агентні налаштування (AGENT=ATLAS|GOOSE|GRISHA)

Повний опис змінних: див. `README.env.md` і `.env.example`.

## 🌐 Ендпоїнти
- GET `/` — статичний інтерфейс (`index.html`), ассети (`DamagedHelmet.glb`, `favicon.ico`)
- GET `/logs/stream` — SSE-стрім живих логів
- GET `/api/status` — зведений статус фронтенду/системи
- GET `/api/atlas/status` — стан Atlas Core, `/api/atlas/health` — healthcheck
- GET `/api/atlas/sessions` — сесії Atlas/Goose; `/api/goose/sessions` — сесії Goose
- GET `/api/atlas/corrections` — статистика автокорекцій; `/api/atlas/corrections/{session}` — історія
- GET `/api/atlas/diagnostics` — діагностика доступності API/сервісів
- POST `/api/chat` — простий чат (non-stream)
- POST `/api/chat/stream` — стрімінговий чат (SSE)
- POST `/api/tts/speak` — синтез мовлення (провайдери: local/gemini/google, з авто-вибором)

Примітка: сервер додає CORS-заголовки й обробляє preflight (OPTIONS).

## 🧩 Архітектура (коротко)
- `services/goose_client.py` — клієнт Goose з авто-визначенням web/ws vs goosed/SSE
- `services/chat_stream.py` — стрім токенів (SSE), з опцією перефразування промптів
- `services/log_streamer.py` — SSE-логгер зі стуком (heartbeat)
- `services/tts_service.py` — вибір TTS-провайдера/голосу, проксі до Atlas Core або локального TTS
- `services/config.py` — геттери конфігурації з ENV
- `services/handlers/*` — вузькі HTTP-хендлери для кожного ресурсу

## 🧪 Розробка та запуск
- Актуальний порт задайте через `ATLAS_PORT` у `.env`
- Якщо порт зайнятий, звільніть його або змініть значення; у репо є утиліти в `scripts/`
- Логи сервера: `frontend/server.log` (якщо увімкнено у скриптах), плюс live-стрім через `/logs/stream`

## 🩺 Усунення проблем
- Goose недоступний: вкажіть `GOOSE_BASE_URL` або запустіть goosed/goose web; клієнт спробує 3000 → 3001
- Atlas Core відсутній: більшість маршрутів працюють у legacy-режимі, але деякі можливості TTS/діагностики залежать від Core
- Помилки залежностей: виконайте `./setup_env.sh` або перевстановіть `requirements.txt`

---

Цей README описує лише папку `frontend/`. Для налаштувань Atlas Core дивіться `frontend/atlas_core/` і кореневі документи репозиторію.
