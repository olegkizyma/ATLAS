# 🚀 Как интегрировать GitHub Models Client в другие проекты

## 📦 Что вы получаете

Готовый модуль для работы с **58 моделями GitHub Models** через ваш прокси сервер.

## 📁 Шаг 1: Скопируйте модуль в ваш проект

```bash
# Скопируйте всю папку client-module в ваш проект
cp -r /path/to/client-module /path/to/your/project/

# Структура после копирования:
your-project/
├── client-module/           # 👈 Скопированный модуль
│   ├── python_client/       # Python клиент
│   ├── nodejs_client/       # Node.js клиент
│   └── models.json         # Список всех моделей
├── your-existing-code/
└── ...
```

## 🐍 Интеграция в Python проекты

### Установка зависимостей
```bash
cd your-project/client-module/python_client
pip install -r requirements.txt
```

### Конфигурация
Создайте `.env` файл в корне вашего проекта:
```env
# .env
GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1
```

### Использование в коде
```python
# your-project/main.py
import sys
import os

# Добавляем путь к модулю
sys.path.append(os.path.join(os.path.dirname(__file__), 'client-module/python_client'))

from client import GitHubModelsClient

# Инициализация клиента
client = GitHubModelsClient()

# Простой запрос
result = client.chat_completion(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Привет!"}]
)

if result['success']:
    print(f"Ответ: {result['content']}")
else:
    print(f"Ошибка: {result['error']}")

# Получить список моделей по провайдеру
openai_models = client.get_models(provider="OpenAI")
print(f"OpenAI моделей: {len(openai_models)}")

# Тестирование нескольких моделей
results = client.test_all_models(
    model_type="chat", 
    limit=3,  # Ограничим 3 моделями для быстроты
    delay_between_requests=0.5  # 500мс между запросами
)

# Эмбеддинги
embedding_result = client.get_embedding(
    model="openai/text-embedding-3-large",
    input_text="Ваш текст для векторизации"
)

if embedding_result['success']:
    print(f"Размерность вектора: {len(embedding_result['embeddings'][0])}")
```

### Пример использования в классе
```python
# your-project/services/ai_service.py
from client_module.python_client.client import GitHubModelsClient

class AIService:
    def __init__(self):
        self.client = GitHubModelsClient(
            max_retries=3,
            retry_delay=1.0
        )
    
    def chat(self, message: str, model: str = "openai/gpt-4o-mini"):
        """Общение с AI моделью"""
        result = self.client.chat_completion(
            model=model,
            messages=[{"role": "user", "content": message}]
        )
        return result
    
    def embed_text(self, text: str):
        """Получение эмбеддингов"""
        result = self.client.get_embedding(
            model="openai/text-embedding-3-large",
            input_text=text
        )
        return result['embeddings'][0] if result['success'] else None
    
    def get_available_models(self, model_type="chat"):
        """Получить доступные модели"""
        return self.client.get_models(model_type=model_type)

# Использование
ai = AIService()
response = ai.chat("Как дела?")
```

## 🟨 Интеграция в Node.js проекты

### Установка зависимостей
```bash
cd your-project/client-module/nodejs_client
npm install
```

### Конфигурация
Создайте `.env` файл в корне вашего проекта:
```env
# .env
GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1
```

### Использование в коде
```javascript
// your-project/main.js
import GitHubModelsClient from './client-module/nodejs_client/client.js';

// Инициализация клиента
const client = new GitHubModelsClient();

// Простой запрос
const result = await client.chatCompletion({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'Привет!' }]
});

if (result.success) {
    console.log(`Ответ: ${result.content}`);
} else {
    console.log(`Ошибка: ${result.error}`);
}

// Получить список моделей по провайдеру
const openaiModels = client.getModels({ provider: 'OpenAI' });
console.log(`OpenAI моделей: ${openaiModels.length}`);

// Тестирование нескольких моделей
const results = await client.testAllModels({
    type: 'chat',
    limit: 3,  // Ограничим 3 моделями
    delayBetweenRequests: 500  // 500мс между запросами
});

// Эмбеддинги
const embeddingResult = await client.getEmbedding({
    model: 'openai/text-embedding-3-large',
    input: 'Ваш текст для векторизации'
});

if (embeddingResult.success) {
    console.log(`Размерность вектора: ${embeddingResult.embeddings[0].length}`);
}
```

### Пример использования в классе
```javascript
// your-project/services/AIService.js
import GitHubModelsClient from '../client-module/nodejs_client/client.js';

export class AIService {
    constructor() {
        this.client = new GitHubModelsClient({
            maxRetries: 3,
            retryDelay: 1000
        });
    }

    async chat(message, model = 'openai/gpt-4o-mini') {
        /**
         * Общение с AI моделью
         */
        const result = await this.client.chatCompletion({
            model,
            messages: [{ role: 'user', content: message }]
        });
        return result;
    }

    async embedText(text) {
        /**
         * Получение эмбеддингов
         */
        const result = await this.client.getEmbedding({
            model: 'openai/text-embedding-3-large',
            input: text
        });
        return result.success ? result.embeddings[0] : null;
    }

    getAvailableModels(type = 'chat') {
        /**
         * Получить доступные модели
         */
        return this.client.getModels({ type });
    }
}

// Использование
const ai = new AIService();
const response = await ai.chat('Как дела?');
```

## 🌐 Интеграция в веб-приложения

### React пример
```jsx
// your-project/src/hooks/useAI.js
import { useState, useEffect } from 'react';
import GitHubModelsClient from '../client-module/nodejs_client/client.js';

export const useAI = () => {
    const [client, setClient] = useState(null);
    const [models, setModels] = useState([]);

    useEffect(() => {
        const aiClient = new GitHubModelsClient();
        setClient(aiClient);
        setModels(aiClient.getModels({ type: 'chat' }));
    }, []);

    const chat = async (message, model = 'openai/gpt-4o-mini') => {
        if (!client) return null;
        
        const result = await client.chatCompletion({
            model,
            messages: [{ role: 'user', content: message }]
        });
        
        return result;
    };

    return { chat, models };
};

// Компонент
// your-project/src/components/ChatComponent.jsx
import { useState } from 'react';
import { useAI } from '../hooks/useAI';

export const ChatComponent = () => {
    const [message, setMessage] = useState('');
    const [response, setResponse] = useState('');
    const [loading, setLoading] = useState(false);
    const { chat } = useAI();

    const handleSend = async () => {
        setLoading(true);
        const result = await chat(message);
        
        if (result.success) {
            setResponse(result.content);
        } else {
            setResponse(`Ошибка: ${result.error}`);
        }
        
        setLoading(false);
    };

    return (
        <div>
            <input 
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Введите сообщение..."
            />
            <button onClick={handleSend} disabled={loading}>
                {loading ? 'Отправка...' : 'Отправить'}
            </button>
            {response && <div>Ответ: {response}</div>}
        </div>
    );
};
```

## 🔧 Настройка и конфигурация

### Переменные окружения
```env
# Обязательно - URL вашего прокси
GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1

# Опционально - если прокси на другом хосте/порту
# GITHUB_MODELS_PROXY_URL=http://your-server:3010/v1
```

### Настройка retry параметров

#### Python:
```python
client = GitHubModelsClient(
    proxy_url="http://localhost:3010/v1",
    max_retries=5,           # Больше попыток для критичных приложений
    retry_delay=2.0,         # Увеличенная задержка
    max_delay=120.0         # Максимум 2 минуты ожидания
)
```

#### Node.js:
```javascript
const client = new GitHubModelsClient({
    proxyURL: 'http://localhost:3010/v1',
    maxRetries: 5,          // Больше попыток
    retryDelay: 2000,       // Увеличенная задержка
    maxDelay: 120000       // Максимум 2 минуты
});
```

## 📋 Все доступные модели

### По провайдерам:
- **OpenAI** (17): gpt-4o-mini, gpt-5, o1, o3, text-embedding-3-large, etc.
- **Microsoft** (15): phi-3-mini-128k-instruct, phi-4, mai-ds-r1, etc.
- **Meta** (7): meta-llama-3.1-8b-instruct, llama-3.3-70b-instruct, etc.
- **Mistral AI** (6): mistral-large-2411, codestral-2501, etc.
- **Cohere** (5): cohere-command-r-08-2024, cohere-embed-v3-english, etc.
- **DeepSeek** (3): deepseek-r1, deepseek-v3-0324, etc.
- **AI21 Labs** (2): ai21-jamba-1.5-large, ai21-jamba-1.5-mini
- **xAI** (2): grok-3, grok-3-mini
- **Core42** (1): jais-30b-chat

### По типам:
- **Chat** (39): Обычные диалоговые модели
- **Reasoning** (6): Модели для рассуждений (O1, O3, Phi-4-reasoning)
- **Embedding** (4): Для векторизации текста
- **Vision** (3): Для работы с изображениями
- **Multimodal** (3): Текст + изображения
- **Code** (1): Специализированные для кода

## 🛡️ Безопасность

### ✅ Что защищено:
- **GitHub токен скрыт** - хранится только на сервере прокси
- **Клиенты используют dummy ключи** - никаких настоящих токенов
- **Защита от rate limiting** - автоматические повторы
- **Задержки между запросами** - предотвращение перегрузки

### ✅ Best practices:
```python
# Ограничивайте количество параллельных запросов
results = client.test_all_models(
    limit=5,                        # Не больше 5 моделей за раз
    delay_between_requests=1.0      # 1 секунда между запросами
)

# Используйте try-catch для критичных операций
try:
    result = client.chat_completion(model="openai/gpt-4o-mini", messages=messages)
    if not result['success']:
        # Обработка ошибки модели
        handle_model_error(result['error'])
except Exception as e:
    # Обработка системной ошибки
    handle_system_error(e)
```

## 🚀 Готово к использованию!

1. **Скопируйте** папку `client-module` в ваш проект
2. **Установите** зависимости (pip install / npm install)
3. **Настройте** `.env` с URL вашего прокси
4. **Импортируйте** и используйте клиент
5. **Наслаждайтесь** доступом ко всем 58 моделям! 

**Никаких токенов, никаких сложностей - просто работающий код!** 🎉
