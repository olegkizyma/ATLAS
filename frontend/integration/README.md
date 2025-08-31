# Atlas TutorialChat Integration

## Опис

Цей модуль забезпечує інтеграцію системи TutorialChat з системою Atlas, створюючи місток між двома API та забезпечуючи сумісність форматів даних.

## Архітектура

```
Atlas System
     │
     ├── atlas_minimal_live.py (головний сервер)
     │    │
     │    ├── integration/
     │    │    ├── chat_integration.py (модуль інтеграції)
     │    │    ├── tutorialchat.html (веб-інтерфейс)
     │    │    └── __init__.py
     │    │
     │    └── TutorialChat/ (компоненти React)
     │         ├── components/
     │         ├── api/
     │         ├── hooks/
     │         └── contexts/
     │
     └── Goose API (зовнішній сервіс)
```

## Компоненти

### 1. `chat_integration.py`
- **AtlasChatIntegration**: Основний клас інтеграції
- **Адаптери форматів**: Перетворення між Atlas та TutorialChat API
- **Обробники запитів**: SSE потоки, сесії, повідомлення
- **Статичні файли**: Обслуговування TutorialChat компонентів

### 2. `tutorialchat.html`
- **Веб-інтерфейс**: Інтерактивний інтерфейс для тестування
- **Налагодження**: Інструменти для моніторингу інтеграції
- **Тестування**: Автоматичні тести API
- **Статус**: Відображення стану підключення

### 3. TutorialChat Components
- **BaseChat.tsx**: Основний компонент чату
- **ChatContext.tsx**: Контекст стану
- **useMessageStream.ts**: Хук для потокових повідомлень
- **API типи**: TypeScript визначення

## API Endpoints

### TutorialChat API (адаптовано для Atlas)

```
POST /api/chat/reply         # Потокові повідомлення чату
GET  /api/session/{id}/history # Історія сесії
POST /api/session           # Створення сесії
GET  /api/tutorialchat/config # Конфігурація інтеграції
```

### Atlas API (оригінальні)

```
POST /api/chat              # Простий чат
POST /api/chat/stream       # Потокові повідомлення
GET  /api/status           # Статус системи
```

## Формати даних

### TutorialChat Request
```json
{
  "message": "Текст повідомлення",
  "session_name": "session_id",
  "model": "gpt-4",
  "temperature": 0.7
}
```

### Atlas Request (адаптований)
```json
{
  "message": "Текст повідомлення",
  "session_name": "session_id", 
  "session_type": "chat",
  "no_paraphrase": false,
  "tutorial_chat_metadata": {
    "original_request": {...},
    "integration_version": "1.0.0"
  }
}
```

### SSE Events
```json
{
  "type": "Message",
  "message": {
    "id": "msg_123",
    "role": "assistant", 
    "content": "Відповідь"
  },
  "timestamp": "2025-08-31T..."
}
```

## Використання

### 1. Запуск сервера

```bash
cd /Users/dev/Documents/GitHub/ATLAS/frontend
python3 atlas_minimal_live.py
```

### 2. Доступ до інтерфейсу

```
http://localhost:8080/tutorialchat
```

### 3. API тестування

```bash
# Тест інтеграції
curl -X POST http://localhost:8080/api/chat/reply \
  -H "Content-Type: application/json" \
  -d '{"message": "Привіт", "session_name": "test"}'

# Конфігурація
curl http://localhost:8080/api/tutorialchat/config
```

## Налагодження

### Логи

```python
import logging
logging.getLogger('integration.chat_integration').setLevel(logging.DEBUG)
```

### Веб-інтерфейс
- Кнопка "Показати налагодження" в інтерфейсі
- Моніторинг SSE подій
- Тестування API викликів

### Статуси інтеграції

- 🟢 **Connected**: Інтеграція працює
- 🟡 **Connecting**: Підключення в процесі  
- 🔴 **Error**: Помилка підключення

## Конфігурація

### Змінні середовища

```bash
GOOSE_BASE_URL=http://127.0.0.1:3000
GOOSE_SECRET_KEY=your-secret-key
ATLAS_CORE_URL=http://127.0.0.1:8000
```

### Config файли

```yaml
# config.yaml
goose:
  base_url: "http://127.0.0.1:3000"
  secret_key: "test"

atlas_core:
  url: "http://127.0.0.1:8000"
```

## Розширення

### Додавання нових API endpoints

```python
def _handle_new_api(self, handler):
    # Логіка обробки
    pass

# У handle_tutorial_chat_api
elif path.startswith("/api/new"):
    return self._handle_new_api(handler)
```

### Додавання нових типів подій

```python
def _adapt_atlas_to_tutorialchat(self, event):
    if event_type == 'new_event_type':
        tutorialchat_event.update({
            'new_field': event.get('data')
        })
```

## Залежності

- **Python 3.8+**
- **aiohttp**: Асинхронні HTTP запити
- **requests**: HTTP клієнт
- **pathlib**: Робота з файловою системою

## Статус розробки

- ✅ Базова інтеграція API
- ✅ Адаптери форматів даних  
- ✅ Веб-інтерфейс тестування
- ✅ SSE потокова передача
- ✅ Обробка сесій
- ⏳ Завантаження файлів
- ⏳ WebSocket підтримка
- ⏳ Повна інтеграція React компонентів

## Підтримка

Для питань та помилок використовуйте:
- Логи сервера: `/logs`
- Веб-інтерфейс: `/tutorialchat`
- API статус: `/api/status`
