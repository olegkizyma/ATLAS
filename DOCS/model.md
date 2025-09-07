

## 📊 Результати тестування 58 моделей:

**✅ Успішність:** 72.4% (42 моделі працюють)

### Найкращі провайдери (100% успішність):
- **Microsoft** (13/13) - всі Phi моделі працюють
- **Meta** (6/6) - всі Llama моделі працюють  
- **Mistral AI** (6/6) - всі моделі працюють
- **DeepSeek** (3/3) - всі моделі працюють
- **AI21 Labs** (2/2) - обидві моделі працюють
- **Core42** (1/1) - модель працює

### Проблемні провайдери:
- **OpenAI** (5/14 - 36%) - багато моделей недоступні
- **xAI** (0/2 - 0%) - Grok моделі тайм-аутяться
- **Cohere** (3/5 - 60%) - embedding моделі не працюють з chat

### 🏆 Найшвидші моделі:
1. `meta/llama-3.2-11b-vision-instruct` - 352ms
2. `mistral-ai/ministral-3b` - 360ms
3. `meta/llama-4-maverick-17b-128e-instruct-fp8` - 353ms

### Головні проблеми:
- Embedding моделі не працюють з chat completions
- GPT-5 моделі недоступні 
- o1/o3 моделі заблоковані (403 Forbidden)
- Grok моделі тайм-аутяться

Створено файли:
- test-all-models.mjs - детальний тестер
- quick-test-models.sh - швидкий тестер  
- MODEL_TEST_REPORT.md - підсумковий звіт
- JSON та CSV звіти з детальними даними

Всі моделі протестовано, робочі моделі ідентифіковано! 🎉

---

# 🤖 Інструкція з налаштування та використання LLM провайдерів

## 📋 Зміст
1. [Встановлення SDK](#встановлення-sdk)
2. [Швидкий старт](#швидкий-старт)
3. [Налаштування провайдерів](#налаштування-провайдерів)
4. [Формування запитів](#формування-запитів)
5. [Параметри моделей](#параметри-моделей)
6. [Обробка помилок](#обробка-помилок)
7. [Приклади коду](#приклади-коду)
8. [Troubleshooting](#troubleshooting)

---

## 🎯 Головне: Використовуйте OpenAI SDK!

**💡 Чому SDK краще за прямі HTTP запити:**

- 🛡️ **Автоматична обробка помилок** та retry логіка
- 🔄 **Зручна потокова передача** (streaming) 
- 📝 **TypeScript підтримка** з автокомплішном
- 🚀 **Менше коду** - більше функціональності
- 🔧 **Знайомий API** як у офіційного OpenAI
- ⚡ **Оптимізовані запити** та connection pooling

**✅ Встановіть SDK та налаштуйте на наш проксі - це займе 2 хвилини, а заощадить години!**

---

## � Встановлення SDK

### JavaScript/Node.js

**Рекомендований спосіб - використовувати офіційний OpenAI SDK:**

```bash
# NPM
npm install openai

# Yarn
yarn add openai

# PNPM
pnpm add openai
```

**Базове налаштування:**

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key', // Будь-який ключ для локального проксі
  baseURL: 'http://localhost:3010/v1' // Ваш локальний проксі
});

// Тепер використовуйте client як звичайний OpenAI клієнт!
```

### Python

**Встановлення:**

```bash
# pip
pip install openai

# conda
conda install openai

# poetry
poetry add openai
```

**Налаштування:**

```python
from openai import OpenAI

client = OpenAI(
    api_key="dummy-key",  # Будь-який ключ для локального проксі
    base_url="http://localhost:3010/v1"  # Ваш проксі
)

# Використовуйте як звичайний OpenAI клієнт
```

### Go

```bash
go get github.com/sashabaranov/go-openai
```

```go
package main

import (
    "github.com/sashabaranov/go-openai"
)

func main() {
    config := openai.DefaultConfig("dummy-key")
    config.BaseURL = "http://localhost:3010/v1"
    client := openai.NewClientWithConfig(config)
}
```

### PHP

```bash
composer require openai-php/client
```

```php
<?php

use OpenAI;

$client = OpenAI::factory()
    ->withApiKey('dummy-key')
    ->withBaseUri('http://localhost:3010/v1')
    ->make();
```

### C# (.NET)

```bash
dotnet add package OpenAI
```

```csharp
using OpenAI;

var client = new OpenAIClient(new OpenAIClientOptions()
{
    ApiKey = "dummy-key",
    BaseUrl = "http://localhost:3010/v1"
});
```

### Ruby

```bash
gem install ruby-openai
```

```ruby
require 'openai'

client = OpenAI::Client.new(
  access_token: 'dummy-key',
  uri_base: 'http://localhost:3010/v1'
)
```

### cURL (для тестування)

```bash
# Базова команда для тестування
curl -X POST "http://localhost:3010/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dummy-key" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## 🔑 Налаштування API ключів

### Варіанти налаштування

**1. Через змінні оточення (рекомендовано):**

```bash
# Додайте до ~/.bashrc, ~/.zshrc або .env файлу
export OPENAI_API_KEY="your-real-api-key"
export OPENAI_BASE_URL="http://localhost:3010/v1"

# Або для GitHub Models
export GITHUB_TOKEN="your-github-token"
```

**2. Через заголовки запитів:**

```javascript
const client = new OpenAI({
  apiKey: 'dummy-key', // Для проксі можна використовувати будь-який
  baseURL: 'http://localhost:3010/v1',
  defaultHeaders: {
    'X-OpenAI-API-Key': 'your-real-api-key' // Реальний ключ
  }
});
```

**3. Для локального проксі (найпростіше):**

```javascript
// Для локального проксі можна використовувати будь-який ключ
const client = new OpenAI({
  apiKey: 'dummy-key', // Підійде будь-який текст
  baseURL: 'http://localhost:3010/v1'
});
```

### 💡 Рекомендації використання API ключів

#### 🔄 Гібридний підхід (найкращий)

```javascript
// Автоматичне визначення типу використання
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
  baseURL: 'http://localhost:3010/v1'
});
```

**Сценарії:**

1. **Локальна розробка:** `dummy-key` ✅
   - Найпростіше налаштування
   - Миттєвий старт
   - Безпечно для тестування

2. **Production з власними ключами:** справжні ключі ✅
   - Індивідуальна статистика
   - Точний біллінг
   - Кращий контроль доступу

3. **Спільний проксі:** один ключ на сервері ✅
   - Централізоване керування
   - Простіше для команди
   - Єдиний біллінг

**Висновок:** Використовуйте `dummy-key` для розробки, справжні ключі для production

---

## �🚀 Швидкий старт

### 1. Перевірка доступності сервера
```bash
curl -s http://localhost:3010/health
# Очікуваний результат: {"status":"ok","timestamp":"...","models":58}
```

### 2. Швидкий тест з SDK (🏆 РЕКОМЕНДОВАНО)

**JavaScript/Node.js:**
```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key',  // Для локального проксі
  baseURL: 'http://localhost:3010/v1'
});

const response = await client.chat.completions.create({
  model: "openai/gpt-4o-mini",
  messages: [{ role: "user", content: "Привіт!" }]
});

console.log(response.choices[0].message.content);
```

**Python:**
```python
from openai import OpenAI

client = OpenAI(
    api_key="dummy-key",
    base_url="http://localhost:3010/v1"
)

response = client.chat.completions.create(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Привіт!"}]
)

print(response.choices[0].message.content)
```

### 3. Отримання списку моделей
```bash
curl -s http://localhost:3010/v1/models | jq '.data[].id' | head -5
```

### 3. Простий тест моделі
```bash
curl -X POST "http://localhost:3010/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o-mini",
    "messages": [{"role": "user", "content": "Hello!"}],
    "max_tokens": 50
  }'
```

---

## ⚙️ Налаштування для клієнтів

### Локальна розробка (рекомендовано)

**Просто використовуйте наш проксі:**

```javascript
// JavaScript/Node.js
const client = new OpenAI({
  apiKey: 'dummy-key',              // Будь-який текст
  baseURL: 'http://localhost:3010/v1'  // Адреса нашого проксі
});
```

```python
# Python
client = OpenAI(
    api_key="dummy-key",
    base_url="http://localhost:3010/v1"
)
```

### Production (якщо потрібно)

**Встановіть справжній API ключ:**

```bash
# Додайте до ~/.bashrc, ~/.zshrc або .env файлу
export OPENAI_API_KEY="your-real-api-key"

# Або для GitHub Models
export GITHUB_TOKEN="your-github-token"
```

**Потім використовуйте як зазвичай:**

```javascript
const client = new OpenAI({
  baseURL: 'http://localhost:3010/v1'  // Ключ візьметься з env
});
```

### 🎯 Головне

- **Для тестування:** `dummy-key` працює ідеально
- **Для production:** встановіть справжній ключ через environment variables
- **Завжди:** використовуйте наш проксі як `baseURL`

---

## 💬 Формування запитів

### Базова структура запиту

```json
{
  "model": "provider/model-name",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Your question here"}
  ],
  "max_tokens": 1000,
  "temperature": 0.7,
  "stream": false
}
```

### Ролі в повідомленнях

```json
{
  "messages": [
    {
      "role": "system",
      "content": "Ви - експерт з програмування. Відповідайте коротко та точно."
    },
    {
      "role": "user", 
      "content": "Як створити REST API на Node.js?"
    },
    {
      "role": "assistant",
      "content": "Для створення REST API використовуйте Express.js..."
    },
    {
      "role": "user",
      "content": "А що з аутентифікацією?"
    }
  ]
}
```

### Multimodal запити (для vision моделей)

```json
{
  "model": "meta/llama-3.2-11b-vision-instruct",
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "Що зображено на картинці?"},
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
          }
        }
      ]
    }
  ]
}
```

---

## 🎛️ Параметри моделей

### Основні параметри

| Параметр | Тип | Діапазон | Опис |
|----------|-----|----------|------|
| `temperature` | float | 0.0-2.0 | Креативність (0=детермінований, 2=дуже креативний) |
| `max_tokens` | int | 1-4096+ | Максимальна кількість токенів у відповіді |
| `top_p` | float | 0.0-1.0 | Nucleus sampling (альтернатива temperature) |
| `frequency_penalty` | float | -2.0-2.0 | Штраф за повторення слів |
| `presence_penalty` | float | -2.0-2.0 | Штраф за повторення тем |
| `stream` | boolean | - | Потокова передача відповіді |

### Рекомендовані налаштування

```javascript
// Для коду та технічних завдань
{
  "temperature": 0.1,
  "max_tokens": 2000,
  "top_p": 0.9
}

// Для креативного письма
{
  "temperature": 0.8,
  "max_tokens": 1500,
  "top_p": 0.95,
  "frequency_penalty": 0.3
}

// Для аналізу та фактів
{
  "temperature": 0.2,
  "max_tokens": 1000,
  "top_p": 0.85,
  "frequency_penalty": 0.1
}

// Для діалогу та чат-бота
{
  "temperature": 0.7,
  "max_tokens": 800,
  "presence_penalty": 0.2
}
```

---

## 🔧 Обробка помилок

### Типи помилок та коди відповіді

```javascript
// 400 - Невірний запит
{
  "error": {
    "message": "you must provide model and messages",
    "type": "invalid_request_error",
    "param": "model",
    "code": null
  }
}

// 401 - Неавторизований доступ
{
  "error": {
    "message": "missing or invalid proxy key",
    "type": "authentication_error",
    "param": null,
    "code": "proxy_key_invalid"
  }
}

// 403 - Заборонений доступ
{
  "error": {
    "message": "Access denied",
    "type": "permission_error",
    "param": null,
    "code": "permission_denied"
  }
}

// 404 - Модель не знайдена
{
  "error": {
    "message": "404 NOT FOUND",
    "type": "invalid_request_error",
    "param": "model",
    "code": null
  }
}

// 429 - Перевищено ліміт
{
  "error": {
    "message": "Upstream rate limit reached (requests). Retry after ~60s.",
    "type": "rate_limit_exceeded",
    "param": "model",
    "code": "rate_limit"
  },
  "rate_limit": {
    "retry_after_seconds": 60,
    "limit_type": "requests",
    "time_remaining": 60
  }
}
```

### Обробка помилок у коді

```javascript
async function callLLM(model, messages, options = {}) {
  try {
    const response = await fetch('http://localhost:3010/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer your-api-key'
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 1000,
        temperature: 0.7,
        ...options
      })
    });

    if (!response.ok) {
      const error = await response.json();
      
      // Обробка rate limit
      if (response.status === 429) {
        const retryAfter = error.rate_limit?.retry_after_seconds || 60;
        console.log(`Rate limited. Retry after ${retryAfter}s`);
        throw new Error(`RATE_LIMITED:${retryAfter}`);
      }
      
      // Обробка інших помилок
      throw new Error(`API_ERROR:${response.status}:${error.error?.message}`);
    }

    return await response.json();
    
  } catch (error) {
    if (error.message.startsWith('RATE_LIMITED:')) {
      const seconds = parseInt(error.message.split(':')[1]);
      // Реімплементуйте retry логіку
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      return callLLM(model, messages, options); // Retry
    }
    
    console.error('LLM call failed:', error.message);
    throw error;
  }
}
```

---

## 💻 Приклади коду

### 🏆 Рекомендовано: Використання OpenAI SDK

#### JavaScript/Node.js (найзручніший спосіб)

```javascript
import OpenAI from 'openai';

// Налаштування клієнта для роботи з нашим проксі
const client = new OpenAI({
  apiKey: 'dummy-key', // Для локального проксі
  baseURL: 'http://localhost:3010/v1' // Ваш проксі сервер
});

// Простий чат
async function simpleChat() {
  const response = await client.chat.completions.create({
    model: "openai/gpt-4o-mini",
    messages: [
      { role: "system", content: "Ви - корисний AI асистент." },
      { role: "user", content: "Привіт! Як справи?" }
    ],
    max_tokens: 1000,
    temperature: 0.7
  });

  console.log(response.choices[0].message.content);
  return response;
}

// Потокова передача (streaming)
async function streamingChat() {
  const stream = await client.chat.completions.create({
    model: "microsoft/phi-4-mini-instruct",
    messages: [{ role: "user", content: "Розкажи анекдот" }],
    stream: true,
    max_tokens: 500
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || '';
    process.stdout.write(content);
  }
}

// Робота з кількома моделями
async function compareModels(prompt) {
  const models = [
    "openai/gpt-4o-mini",
    "microsoft/phi-4-mini-instruct", 
    "mistral-ai/ministral-3b"
  ];

  const results = await Promise.allSettled(
    models.map(async (model) => {
      const start = Date.now();
      const response = await client.chat.completions.create({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 200,
        temperature: 0.5
      });
      
      return {
        model,
        response: response.choices[0].message.content,
        duration: Date.now() - start,
        tokens: response.usage?.total_tokens
      };
    })
  );

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      const { model, response, duration, tokens } = result.value;
      console.log(`\n🤖 ${model} (${duration}ms, ${tokens} токенів):`);
      console.log(response);
    } else {
      console.log(`\n❌ ${models[i]}: ${result.reason.message}`);
    }
  });
}

// Використання
await simpleChat();
await streamingChat();
await compareModels("Поясни що таке Node.js");
```

#### Python (також дуже зручно)

```python
from openai import OpenAI
import asyncio
import time

# Налаштування клієнта
client = OpenAI(
    api_key="dummy-key",
    base_url="http://localhost:3010/v1"
)

def simple_chat(model="openai/gpt-4o-mini", message="Привіт!"):
    """Простий чат з моделлю"""
    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "Ви - корисний AI асистент."},
                {"role": "user", "content": message}
            ],
            max_tokens=1000,
            temperature=0.7
        )
        
        return response.choices[0].message.content
        
    except Exception as e:
        print(f"Помилка з моделлю {model}: {e}")
        return None

def streaming_chat(model="microsoft/phi-4-mini-instruct", message="Розкажи анекдот"):
    """Потокова передача"""
    try:
        stream = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": message}],
            stream=True,
            max_tokens=500
        )
        
        print(f"🤖 {model}:")
        for chunk in stream:
            content = chunk.choices[0].delta.content or ""
            print(content, end="", flush=True)
        print("\n")
        
    except Exception as e:
        print(f"Помилка: {e}")

def test_multiple_models(prompt="Що таке Python?"):
    """Тестування кількох моделей"""
    models = [
        "openai/gpt-4o-mini",
        "microsoft/phi-4-mini-instruct",
        "mistral-ai/ministral-3b",
        "meta/llama-3.2-11b-vision-instruct"
    ]
    
    for model in models:
        print(f"\n{'='*50}")
        print(f"🤖 Тестування {model}")
        print('='*50)
        
        start_time = time.time()
        result = simple_chat(model, prompt)
        duration = time.time() - start_time
        
        if result:
            print(f"⏱️ Час відповіді: {duration:.2f}с")
            print(f"📝 Відповідь: {result[:200]}...")
        else:
            print("❌ Модель недоступна")

# Асинхронна версія для кращої продуктивності
async def async_chat_multiple():
    """Асинхронне тестування моделей"""
    from openai import AsyncOpenAI
    
    async_client = AsyncOpenAI(
        api_key="dummy-key",
        base_url="http://localhost:3010/v1"
    )
    
    models = ["openai/gpt-4o-mini", "microsoft/phi-4-mini-instruct"]
    prompt = "Напиши короткий вірш про програмування"
    
    tasks = []
    for model in models:
        task = async_client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200
        )
        tasks.append(task)
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for i, result in enumerate(results):
        print(f"\n🤖 {models[i]}:")
        if isinstance(result, Exception):
            print(f"❌ Помилка: {result}")
        else:
            print(f"✅ {result.choices[0].message.content}")

# Використання
if __name__ == "__main__":
    # Прості тести
    print(simple_chat())
    streaming_chat()
    test_multiple_models()
    
    # Асинхронний тест
    asyncio.run(async_chat_multiple())
```

### 🛠️ Практичні помічники

#### Клас для роботи з множинними моделями

```javascript
class MultiLLMClient {
  constructor(baseURL = 'http://localhost:3010/v1') {
    this.client = new OpenAI({
      apiKey: 'dummy-key',
      baseURL
    });
    
    // Швидкі моделі для тестування
    this.fastModels = [
      'mistral-ai/ministral-3b',
      'meta/llama-3.2-11b-vision-instruct',
      'microsoft/phi-4-mini-instruct'
    ];
    
    // Потужні моделі для складних завдань
    this.powerfulModels = [
      'openai/gpt-4o-mini',
      'microsoft/phi-4-reasoning',
      'meta/meta-llama-3.1-405b-instruct'
    ];
  }

  async quickTest(message = "Hello!") {
    console.log("🚀 Швидкий тест найшвидших моделей:");
    
    for (const model of this.fastModels) {
      const start = Date.now();
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [{ role: "user", content: message }],
          max_tokens: 50,
          temperature: 0.5
        });
        
        const duration = Date.now() - start;
        console.log(`✅ ${model}: ${duration}ms`);
        console.log(`   "${response.choices[0].message.content.slice(0, 60)}..."`);
        
      } catch (error) {
        console.log(`❌ ${model}: ${error.message}`);
      }
    }
  }

  async bestModel(task, message) {
    const modelMap = {
      'code': 'microsoft/phi-4-mini-instruct',
      'creative': 'openai/gpt-4o-mini', 
      'analysis': 'microsoft/phi-4-reasoning',
      'fast': 'mistral-ai/ministral-3b'
    };
    
    const model = modelMap[task] || modelMap.fast;
    
    return await this.client.chat.completions.create({
      model,
      messages: [{ role: "user", content: message }],
      max_tokens: 1000,
      temperature: task === 'creative' ? 0.8 : 0.3
    });
  }

  async compareResponses(message, models = this.fastModels.slice(0, 3)) {
    console.log(`🔄 Порівняння відповідей на: "${message}"`);
    
    const promises = models.map(async (model) => {
      const start = Date.now();
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [{ role: "user", content: message }],
          max_tokens: 200,
          temperature: 0.7
        });
        
        return {
          model,
          success: true,
          response: response.choices[0].message.content,
          duration: Date.now() - start,
          tokens: response.usage?.total_tokens
        };
      } catch (error) {
        return {
          model,
          success: false,
          error: error.message,
          duration: Date.now() - start
        };
      }
    });

    const results = await Promise.all(promises);
    
    results.forEach(result => {
      console.log(`\n🤖 ${result.model} (${result.duration}ms):`);
      if (result.success) {
        console.log(`📝 ${result.response}`);
        console.log(`🎯 Токенів: ${result.tokens}`);
      } else {
        console.log(`❌ Помилка: ${result.error}`);
      }
    });

    return results;
  }
}

// Використання
const llm = new MultiLLMClient();

// Швидкий тест
await llm.quickTest("Привіт!");

// Вибір найкращої моделі для завдання
const codeResponse = await llm.bestModel('code', 'Створи функцію сортування масиву');
console.log(codeResponse.choices[0].message.content);

// Порівняння відповідей
await llm.compareResponses("Поясни різницю між React та Vue.js");
```

### 📱 Мобільні та веб додатки

#### React компонент

```jsx
import { useState } from 'react';
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key',
  baseURL: 'http://localhost:3010/v1',
  dangerouslyAllowBrowser: true // Тільки для розробки!
});

export function ChatComponent() {
  const [message, setMessage] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState('openai/gpt-4o-mini');

  const sendMessage = async () => {
    if (!message.trim()) return;
    
    setLoading(true);
    try {
      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'user', content: message }],
        max_tokens: 500,
        temperature: 0.7
      });
      
      setResponse(completion.choices[0].message.content);
    } catch (error) {
      setResponse(`Помилка: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <select 
        value={model} 
        onChange={(e) => setModel(e.target.value)}
        className="model-selector"
      >
        <option value="openai/gpt-4o-mini">GPT-4o Mini</option>
        <option value="microsoft/phi-4-mini-instruct">Phi-4 Mini</option>
        <option value="mistral-ai/ministral-3b">Ministral 3B</option>
      </select>
      
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Введіть ваше повідомлення..."
        rows={4}
      />
      
      <button onClick={sendMessage} disabled={loading}>
        {loading ? 'Відправляю...' : 'Відправити'}
      </button>
      
      {response && (
        <div className="response">
          <h3>Відповідь {model}:</h3>
          <p>{response}</p>
        </div>
      )}
    </div>
  );
}
```

### 🔧 Налагодження та моніторинг

```javascript
// Клієнт з логуванням та метриками
class DebugLLMClient {
  constructor() {
    this.client = new OpenAI({
      apiKey: 'dummy-key',
      baseURL: 'http://localhost:3010/v1'
    });
    
    this.stats = {
      requests: 0,
      errors: 0,
      totalTokens: 0,
      totalTime: 0
    };
  }

  async chat(model, messages, options = {}) {
    const requestId = Date.now().toString(36);
    const start = Date.now();
    
    console.log(`📤 [${requestId}] Запит до ${model}`);
    console.log(`📝 Повідомлення:`, messages);
    
    this.stats.requests++;
    
    try {
      const response = await this.client.chat.completions.create({
        model,
        messages,
        max_tokens: 1000,
        temperature: 0.7,
        ...options
      });
      
      const duration = Date.now() - start;
      const tokens = response.usage?.total_tokens || 0;
      
      this.stats.totalTime += duration;
      this.stats.totalTokens += tokens;
      
      console.log(`📥 [${requestId}] Відповідь отримана за ${duration}ms`);
      console.log(`🎯 Токенів: ${tokens} (prompt: ${response.usage?.prompt_tokens}, completion: ${response.usage?.completion_tokens})`);
      console.log(`💬 Відповідь:`, response.choices[0].message.content.slice(0, 100) + '...');
      
      return response;
      
    } catch (error) {
      const duration = Date.now() - start;
      this.stats.errors++;
      
      console.error(`❌ [${requestId}] Помилка за ${duration}ms:`, error.message);
      throw error;
    }
  }

  getStats() {
    const avgTime = this.stats.requests > 0 ? this.stats.totalTime / this.stats.requests : 0;
    
    return {
      ...this.stats,
      averageTime: Math.round(avgTime),
      successRate: this.stats.requests > 0 ? 
        ((this.stats.requests - this.stats.errors) / this.stats.requests * 100).toFixed(1) + '%' : 
        '0%'
    };
  }

  resetStats() {
    this.stats = { requests: 0, errors: 0, totalTokens: 0, totalTime: 0 };
  }
}

// Використання
const debugClient = new DebugLLMClient();

await debugClient.chat('openai/gpt-4o-mini', [
  { role: 'user', content: 'Привіт!' }
]);

console.log('📊 Статистика:', debugClient.getStats());
```

---

### ⚡ Переваги використання SDK

**1. 🛡️ Автоматична обробка помилок**
- Retry логіка для тимчасових збоїв
- Правильне форматування помилок
- Автоматичні таймаути

**2. 🔄 Потокова передача (Streaming)**
- Простий API для роботи з потоками
- Автоматичне парсування SSE
- Обробка переривань

**3. 📝 TypeScript підтримка**
- Автокомплішн в IDE
- Перевірка типів
- Документація "на льоту"

**4. 🚀 Продуктивність**
- Connection pooling
- Оптимізовані запити
- Менше boilerplate коду

**5. 🔧 Зручність розробки**
- Знайома API схожа на офіційний OpenAI
- Багато прикладів та документації
- Активна спільнота

---

```javascript
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'dummy-key', // Може бути будь-яким для локального проксі
  baseURL: 'http://localhost:3010/v1'
});

async function chatWithModel(model, userMessage) {
  try {
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: "Ви - корисний AI асистент." },
        { role: "user", content: userMessage }
      ],
      max_tokens: 1000,
      temperature: 0.7
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error(`Помилка з моделлю ${model}:`, error.message);
    return null;
  }
}

// Використання
const result = await chatWithModel('openai/gpt-4o-mini', 'Привіт! Як справи?');
console.log(result);
```

### 2. Python

```python
#!/usr/bin/env python3
import requests
import json

def call_llm(model, messages, max_tokens=1000, temperature=0.7):
    """
    Викликає LLM через локальний проксі
    """
    url = "http://localhost:3010/v1/chat/completions"
    
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature
    }
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer dummy-key"  # Для локального проксі
    }
    
    try:
        response = requests.post(url, json=payload, headers=headers, timeout=30)
        response.raise_for_status()
        
        data = response.json()
        return data['choices'][0]['message']['content']
        
    except requests.exceptions.RequestException as e:
        print(f"Помилка запиту: {e}")
        return None
    except KeyError as e:
        print(f"Помилка парсингу відповіді: {e}")
        return None

# Використання
messages = [
    {"role": "system", "content": "Ви - експерт з Python програмування."},
    {"role": "user", "content": "Як створити декоратор у Python?"}
]

result = call_llm("microsoft/phi-4-mini-instruct", messages)
print(result)
```

### 3. Streaming відповіді

```javascript
async function streamChat(model, messages) {
  const response = await fetch('http://localhost:3010/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer dummy-key'
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 1000
    })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n').filter(line => line.trim() !== '');
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            process.stdout.write(content); // Виводимо по частинах
          }
        } catch (e) {
          // Ігноруємо помилки парсингу
        }
      }
    }
  }
}
```

### 4. Bash скрипт для тестування

```bash
#!/bin/bash

# Функція для виклику LLM
call_llm() {
    local model="$1"
    local message="$2"
    local max_tokens="${3:-500}"
    
    curl -s -X POST "http://localhost:3010/v1/chat/completions" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer dummy-key" \
        -d "{
            \"model\": \"$model\",
            \"messages\": [
                {\"role\": \"user\", \"content\": \"$message\"}
            ],
            \"max_tokens\": $max_tokens,
            \"temperature\": 0.7
        }" | jq -r '.choices[0].message.content // .error.message'
}

# Тестування різних моделей
echo "Тестування швидких моделей:"
echo "============================"

models=(
    "mistral-ai/ministral-3b"
    "meta/llama-3.2-11b-vision-instruct"
    "microsoft/phi-4-mini-instruct"
)

for model in "${models[@]}"; do
    echo "Модель: $model"
    echo "Відповідь: $(call_llm "$model" "Привіт! Як справи?")"
    echo "---"
done
```

---

## 🔍 Troubleshooting

### Поширені проблеми та рішення

#### 1. Сервер не відповідає
```bash
# Перевірити чи запущений сервер
curl -s http://localhost:3010/health

# Якщо не працює, запустити:
npm start
# або
node server.js
```

#### 2. 401 Authentication Error
```bash
# Перевірити змінні оточення
echo $OPENAI_API_KEY
echo $GITHUB_TOKEN

# Або передати ключ в заголовку
curl -H "Authorization: Bearer your-key" ...
```

#### 3. 404 Model Not Found
```bash
# Перевірити доступні моделі
curl -s http://localhost:3010/v1/models | jq '.data[].id'

# Використовувати точну назву моделі:
# ✅ Правильно: "openai/gpt-4o-mini"
# ❌ Неправильно: "gpt-4o-mini"
```

#### 4. 429 Rate Limit
```bash
# Перевірити поточні ліміти
curl -s http://localhost:3010/v1/rate-limits/observed

# Зачекати та повторити запит
sleep 60 && curl ...
```

#### 5. Повільні відповіді
```bash
# Використовувати швидші моделі:
echo "Найшвидші моделі:"
echo "- mistral-ai/ministral-3b (360ms)"
echo "- meta/llama-3.2-11b-vision-instruct (352ms)"
echo "- meta/llama-4-maverick-17b-128e-instruct-fp8 (353ms)"
```

#### 6. Таймаути
```javascript
// Збільшити таймаут у коді
const response = await fetch(url, {
  ...options,
  signal: AbortSignal.timeout(60000) // 60 секунд
});
```

### Корисні команди для діагностики

```bash
# Перевірити логи сервера
tail -f server.log

# Перевірити метрики
curl -s http://localhost:3010/metrics | grep -E "(requests_total|errors_total)"

# Перевірити готовність
curl -s http://localhost:3010/ready

# Протестувати конкретну модель
./quick-test-models.sh | grep "model-name"

# Детальне тестування
node test-all-models.mjs 2>&1 | tee test-results.log
```

### Налагодження запитів

```bash
# Увімкнути детальні логи
export DEBUG=1

# Перевірити структуру запиту
echo '{
  "model": "openai/gpt-4o-mini",
  "messages": [{"role": "user", "content": "test"}]
}' | jq . # Валідація JSON

# Тест з verbose виводом
curl -v -X POST "http://localhost:3010/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"model": "openai/gpt-4o-mini", "messages": [{"role": "user", "content": "test"}]}'
```

---

## 📚 Додаткові ресурси

- **Детальний звіт тестування:** [MODEL_TEST_REPORT.md](MODEL_TEST_REPORT.md)
- **OpenAI API документація:** https://platform.openai.com/docs/api-reference
- **GitHub Models:** https://github.com/marketplace/models
- **Скрипти тестування:** 
  - `test-all-models.mjs` - повне тестування
  - `quick-test-models.sh` - швидка перевірка

---

*Цей документ регулярно оновлюється. Остання редакція: 8 вересня 2025*