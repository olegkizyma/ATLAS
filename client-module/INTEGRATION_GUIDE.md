# 📦 Инструкции по интеграции модуля

## 🎯 Готовый модуль для интеграции

Этот модуль содержит готовые клиенты для работы с GitHub Models через прокси. Поддерживаются все 58 доступных моделей.

## 📁 Структура модуля

```
client-module/
├── models.json                    # Полный список всех 58 моделей
├── python_client/                 # Python клиент
│   ├── client.py                  # Основной класс клиента
│   ├── requirements.txt           # Зависимости Python
│   └── .env.example              # Пример конфигурации
├── nodejs_client/                 # Node.js клиент
│   ├── client.js                  # Основной класс клиента
│   ├── package.json              # Зависимости Node.js
│   ├── test.js                   # Тесты
│   └── .env.example              # Пример конфигурации
└── README.md                      # Документация
```

## 🚀 Интеграция в ваш проект

### Вариант 1: Копирование модуля

```bash
# Скопируйте папку client-module в ваш проект
cp -r client-module /path/to/your/project/

# Для Python
cd /path/to/your/project/client-module/python_client
pip install -r requirements.txt

# Для Node.js
cd /path/to/your/project/client-module/nodejs_client
npm install
```

### Вариант 2: Использование как подмодуль

```bash
# Добавьте как git submodule (если это git репозиторий)
git submodule add <repository-url> client-module
```

## 💻 Использование в коде

### Python

```python
# Импорт модуля
from client_module.python_client.client import GitHubModelsClient

# Инициализация
client = GitHubModelsClient()

# Простой запрос
result = client.chat_completion(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Привет!"}]
)

if result['success']:
    print(result['content'])
else:
    print(f"Ошибка: {result['error']}")

# Получить список моделей по провайдеру
openai_models = client.get_models(provider="OpenAI")
print(f"OpenAI моделей: {len(openai_models)}")

# Тестирование всех chat моделей (ограничение 5)
results = client.test_all_models(model_type="chat", limit=5)
```

### Node.js

```javascript
// Импорт модуля
import GitHubModelsClient from './client-module/nodejs_client/client.js';

// Инициализация
const client = new GitHubModelsClient();

// Простой запрос
const result = await client.chatCompletion({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'Привет!' }]
});

if (result.success) {
    console.log(result.content);
} else {
    console.log(`Ошибка: ${result.error}`);
}

// Получить список моделей по типу
const chatModels = client.getModels({ type: 'chat' });
console.log(`Chat моделей: ${chatModels.length}`);

// Тестирование всех chat моделей (ограничение 5)
const results = await client.testAllModels({ 
    type: 'chat', 
    limit: 5 
});
```

## ⚙️ Конфигурация

### Переменные окружения

Создайте файл `.env` в корне вашего проекта:

```env
# URL вашего GitHub Models прокси
GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1

# Альтернативно - прямое подключение к GitHub
# GITHUB_TOKEN=your_github_token_here
# GITHUB_MODELS_BASE_URL=https://models.github.ai/inference
```

### Программная конфигурация

```python
# Python - кастомная конфигурация
client = GitHubModelsClient(
    api_key="custom-key",
    proxy_url="http://your-proxy:3010/v1"
)
```

```javascript
// Node.js - кастомная конфигурация
const client = new GitHubModelsClient({
    apiKey: 'custom-key',
    proxyURL: 'http://your-proxy:3010/v1'
});
```

## 🧪 Тестирование интеграции

### Python

```bash
cd client-module/python_client
python client.py
```

### Node.js

```bash
cd client-module/nodejs_client
npm start
# или
npm test
```

## 📋 Все 58 поддерживаемых моделей

### OpenAI (15 моделей)
- gpt-4.1, gpt-4.1-mini, gpt-4.1-nano
- gpt-4o, gpt-4o-mini
- gpt-5, gpt-5-chat, gpt-5-mini, gpt-5-nano
- o1, o1-mini, o1-preview
- o3, o3-mini, o4-mini
- text-embedding-3-large, text-embedding-3-small

### Microsoft (13 моделей)
- phi-3-medium-128k-instruct, phi-3-medium-4k-instruct
- phi-3-mini-128k-instruct, phi-3-mini-4k-instruct
- phi-3-small-128k-instruct, phi-3-small-8k-instruct
- phi-3.5-mini-instruct, phi-3.5-moe-instruct, phi-3.5-vision-instruct
- phi-4, phi-4-mini-instruct, phi-4-mini-reasoning
- phi-4-multimodal-instruct, phi-4-reasoning
- mai-ds-r1

### Meta (6 моделей)
- llama-3.2-11b-vision-instruct, llama-3.2-90b-vision-instruct
- llama-3.3-70b-instruct
- llama-4-maverick-17b-128e-instruct-fp8, llama-4-scout-17b-16e-instruct
- meta-llama-3.1-405b-instruct, meta-llama-3.1-8b-instruct

### Mistral AI (6 моделей)
- codestral-2501, ministral-3b
- mistral-large-2411, mistral-medium-2505
- mistral-nemo, mistral-small-2503

### Cohere (5 моделей)
- cohere-command-a, cohere-command-r-08-2024, cohere-command-r-plus-08-2024
- cohere-embed-v3-english, cohere-embed-v3-multilingual

### DeepSeek (3 модели)
- deepseek-r1, deepseek-r1-0528, deepseek-v3-0324

### AI21 Labs (2 модели)
- ai21-jamba-1.5-large, ai21-jamba-1.5-mini

### xAI (2 модели)
- grok-3, grok-3-mini

### Core42 (1 модель)
- jais-30b-chat

## 🔧 Возможности модуля

### ✅ Основные функции

- 🚀 **Поддержка всех 58 моделей** GitHub Models
- 🔄 **Chat Completions** для всех chat/reasoning моделей  
- 🔍 **Embeddings** для embedding моделей
- 👁️ **Vision** поддержка для multimodal моделей
- 📊 **Фильтрация моделей** по провайдеру и типу
- 🧪 **Автоматическое тестирование** моделей
- ⚡ **Асинхронная работа** (Node.js) и синхронная (Python)
- 🔐 **Безопасность** - работа через прокси без раскрытия токенов

### ✅ Дополнительные возможности

- 📈 **Статистика использования** токенов
- 🎯 **Гибкая конфигурация** через env или код
- 🔄 **Обработка ошибок** с подробными сообщениями
- 📋 **Детальная информация** о каждой модели
- 🧪 **Встроенные тесты** для проверки работоспособности

## 🎉 Готово к использованию!

Модуль полностью готов для интеграции в ваши проекты. Он предоставляет единый интерфейс для работы со всеми 58 моделями GitHub Models через ваш прокси сервер.

**Никаких дополнительных настроек не требуется - просто скопируйте и используйте!** 🚀
