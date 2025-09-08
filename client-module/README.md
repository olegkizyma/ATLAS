# 🚀 GitHub Models Client Module

Готовый модуль для интеграции с **58 моделями GitHub Models** через ваш прокси сервер.

## 📦 Что вы получаете

✅ **Python клиент** - `python_client/client.py` (320+ строк)  
✅ **Node.js клиент** - `nodejs_client/client.js` (400+ строк)  
✅ **58 моделей** - полный каталог от 9 провайдеров  
✅ **Защита от ошибок** - автоматические повторы с экспоненциальной задержкой  
✅ **Безопасность** - работа только через ваш прокси, токены скрыты  
✅ **Готовые примеры** - веб-приложения, боты, CLI инструменты  

## 🚀 Быстрый старт - 3 минуты

### 1. Скопируйте модуль
```bash
cp -r client-module /path/to/your/project/
```

### 2. Python
```bash
cd client-module/python_client && pip install -r requirements.txt
```

```python
from client_module.python_client.client import GitHubModelsClient

client = GitHubModelsClient()
result = client.chat_completion(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Привет!"}]
)
print(result['content'])  # Ответ модели
```

### 3. Node.js
```bash
cd client-module/nodejs_client && npm install
```

```javascript
import GitHubModelsClient from './client-module/nodejs_client/client.js';

const client = new GitHubModelsClient();
const result = await client.chatCompletion({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'Привет!' }]
});
console.log(result.content);  // Ответ модели
```

### 4. Конфигурация
Создайте `.env` файл:
```env
GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1
```

## 🌟 Все возможности

### 💬 Chat Completions
```python
# Простое общение
result = client.chat_completion(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Привет!"}]
)

# Сложные рассуждения  
result = client.chat_completion(
    model="openai/o1-preview",
    messages=[{"role": "user", "content": "Объясни квантовую физику"}]
)

# Работа с кодом
result = client.chat_completion(
    model="mistralai/codestral-2501",
    messages=[{"role": "user", "content": "Напиши функцию сортировки"}]
)
```

### 🔢 Embeddings (векторизация)
```python
result = client.get_embedding(
    model="openai/text-embedding-3-large",
    input_text="Машинное обучение и искусственный интеллект"
)

if result['success']:
    vector = result['embeddings'][0]
    print(f"Размерность: {len(vector)}")  # 3072
```

### 📋 Управление моделями
```python
# Все модели
all_models = client.get_models()
print(f"Всего моделей: {len(all_models)}")  # 58

# По провайдеру
openai_models = client.get_models(provider="OpenAI")
meta_models = client.get_models(provider="Meta")

# По типу
chat_models = client.get_models(model_type="chat")      # 39 моделей
reasoning_models = client.get_models(model_type="reasoning")  # 6 моделей
embedding_models = client.get_models(model_type="embedding")  # 4 модели

# Статистика
stats = client.get_statistics()
print(f"Чат моделей: {stats['chat']}")
print(f"Эмбеддинг моделей: {stats['embedding']}")
```

### 🧪 Тестирование моделей
```python
# Быстрый тест топ-5 моделей
results = client.test_all_models(
    model_type="chat",
    limit=5,
    test_message="Привет! Как дела?",
    delay_between_requests=1.0  # 1 секунда между запросами
)

success_count = sum(1 for r in results if r['success'])
print(f"Успешно: {success_count}/{len(results)}")
```

## 🏆 Все 58 моделей

### 🏢 По провайдерам:
- **OpenAI** (17): gpt-4o-mini, gpt-5, o1, o3-mini, text-embedding-3-large, etc.
- **Microsoft** (15): phi-3-mini, phi-4, phi-4-reasoning, mai-ds-r1, etc.
- **Meta** (7): llama-3.1-8b, llama-3.3-70b, llama-3.2-11b-vision, etc.
- **Mistral AI** (6): mistral-large-2411, codestral-2501, pixtral-large, etc.
- **Cohere** (5): command-r-08-2024, command-r-plus-08-2024, embed-v3, etc.
- **DeepSeek** (3): deepseek-r1, deepseek-v3, deepseek-coder-v2, etc.
- **AI21 Labs** (2): jamba-1.5-large, jamba-1.5-mini
- **xAI** (2): grok-3, grok-3-mini  
- **Core42** (1): jais-30b-chat

### 🎯 По специализации:
- **💬 Chat** (39): Обычное общение и диалоги
- **🧠 Reasoning** (6): Сложные рассуждения (O1, O3, Phi-4-reasoning)
- **🔢 Embedding** (4): Векторизация текста для поиска
- **👁️ Vision** (3): Анализ изображений
- **🎨 Multimodal** (3): Текст + изображения
- **💻 Code** (1): Специализация на коде

## 🛡️ Защита от ошибок

### ✅ Автоматические повторы:
- **Экспоненциальная задержка** - 1s → 2s → 4s → 8s...
- **Jitter** - случайные вариации для предотвращения перегрузки
- **Умные коды ошибок** - разная логика для 429, 500, timeout
- **Максимальные лимиты** - защита от бесконечных циклов

### ⚙️ Настройка retry логики:
```python
# Более агрессивные повторы для критичных приложений
client = GitHubModelsClient(
    max_retries=5,           # 5 попыток вместо 3
    retry_delay=2.0,         # Начинаем с 2 секунд
    max_delay=120.0,         # Максимум 2 минуты ожидания
    timeout=60.0             # Увеличенный timeout
)
```

## 📚 Полная документация

📖 **INTEGRATION_FOR_OTHER_PROJECTS.md** - Как интегрировать в другие проекты  
🎯 **REAL_WORLD_EXAMPLES.md** - Готовые примеры: веб-приложения, боты, CLI  
⚡ **QUICK_START.md** - Краткая инструкция для быстрого старта  
🔧 **FINAL_UPDATES.md** - Последние изменения и фиксы  
📊 **models.json** - Полный каталог моделей с метаданными  

## 🎉 Готовые примеры интеграции

### 🌐 Веб-приложение с чатом (React + Express)
### 🔍 Поисковая система с эмбеддингами  
### 🤖 Telegram бот с выбором моделей
### 📱 CLI инструмент для терминала
### 🏗️ Микросервисы с AI функциями

*Все примеры в `REAL_WORLD_EXAMPLES.md`*

## 🔧 Технические детали

### Python клиент (320+ строк):
- **Класс**: `GitHubModelsClient`
- **Зависимости**: `openai`, `requests`, `python-dotenv`
- **Методы**: `chat_completion()`, `get_embedding()`, `test_all_models()`
- **Retry логика**: `_execute_with_retry()` с экспоненциальной задержкой

### Node.js клиент (400+ строк):
- **Класс**: `GitHubModelsClient` 
- **Зависимости**: `openai`, `dotenv`
- **Методы**: `chatCompletion()`, `getEmbedding()`, `testAllModels()`
- **Retry логика**: `_executeWithRetry()` с Promise-based подходом

## 🌍 Интеграция в другие проекты

```bash
# 1. Скопируйте модуль
cp -r client-module /your/project/

# 2. Установите зависимости  
cd client-module/python_client && pip install -r requirements.txt
cd client-module/nodejs_client && npm install

# 3. Настройте .env
echo "GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1" > .env

# 4. Импортируйте и используйте!
```

## ✅ Что уже работает

✅ **Все 58 моделей** протестированы  
✅ **Embedding ошибки исправлены** (422 → OpenAI embeddings)  
✅ **Rate limiting защита** работает  
✅ **Retry логика** с экспоненциальной задержкой  
✅ **Безопасность** - токены скрыты от клиентов  
✅ **Готовые примеры** для разных типов проектов  

## 🚀 Начните прямо сейчас!

**Никаких токенов, никаких сложностей - просто скопируйте и используйте все 58 моделей!** 🎉
