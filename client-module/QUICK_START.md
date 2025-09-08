# 📝 Краткая инструкция для разработчиков

## 🔥 Быстрый старт - 3 минуты до первого запроса

### 1. Скопируйте модуль в ваш проект

```bash
cp -r client-module /path/to/your/project/
```

### 2. Python интеграция

**Установка:**
```bash
cd client-module/python_client && pip install -r requirements.txt
```

**Код:**
```python
from client_module.python_client.client import GitHubModelsClient

client = GitHubModelsClient()
result = client.chat_completion(
    model="openai/gpt-4o-mini",
    messages=[{"role": "user", "content": "Привет!"}]
)
print(result['content'])  # Ответ модели
```

### 3. Node.js интеграция

**Установка:**
```bash
cd client-module/nodejs_client && npm install
```

**Код:**
```javascript
import GitHubModelsClient from './client-module/nodejs_client/client.js';

const client = new GitHubModelsClient();
const result = await client.chatCompletion({
    model: 'openai/gpt-4o-mini',
    messages: [{ role: 'user', content: 'Привет!' }]
});
console.log(result.content);  // Ответ модели
```

## 🌟 Возможности

✅ **58 моделей** из 9 провайдеров  
✅ **Автоматические повторы** при ошибках  
✅ **Защита от rate limiting**  
✅ **Безопасность** - GitHub токен скрыт  
✅ **Эмбеддинги** для векторизации  

## 🛠️ Конфигурация

Создайте `.env` файл:
```env
GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1
```

## 🚀 Готово!

Полное руководство в `INTEGRATION_FOR_OTHER_PROJECTS.md`
