# 💼 Примеры интеграции в реальные проекты

## 🎯 Веб-приложение с чатом

### Структура проекта:
```
my-chat-app/
├── client-module/          # Скопированный модуль
├── backend/
│   ├── routes/
│   │   └── chat.js         # API для чата
│   └── app.js              # Express сервер
├── frontend/
│   ├── components/
│   │   └── Chat.jsx        # React компонент
│   └── index.js
└── .env                    # Конфигурация
```

### Backend (Express.js):
```javascript
// backend/routes/chat.js
import express from 'express';
import GitHubModelsClient from '../../client-module/nodejs_client/client.js';

const router = express.Router();
const aiClient = new GitHubModelsClient();

router.post('/api/chat', async (req, res) => {
    try {
        const { message, model = 'openai/gpt-4o-mini' } = req.body;
        
        const result = await aiClient.chatCompletion({
            model,
            messages: [{ role: 'user', content: message }]
        });
        
        if (result.success) {
            res.json({ response: result.content });
        } else {
            res.status(500).json({ error: result.error });
        }
    } catch (error) {
        res.status(500).json({ error: 'Server error' });
    }
});

// Получить список доступных моделей
router.get('/api/models', (req, res) => {
    const models = aiClient.getModels({ type: 'chat' });
    res.json(models);
});

export default router;
```

### Frontend (React):
```jsx
// frontend/components/Chat.jsx
import { useState, useEffect } from 'react';

export const Chat = () => {
    const [message, setMessage] = useState('');
    const [messages, setMessages] = useState([]);
    const [models, setModels] = useState([]);
    const [selectedModel, setSelectedModel] = useState('openai/gpt-4o-mini');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Загрузить список моделей
        fetch('/api/models')
            .then(res => res.json())
            .then(setModels);
    }, []);

    const sendMessage = async () => {
        if (!message.trim()) return;
        
        setLoading(true);
        setMessages(prev => [...prev, { role: 'user', content: message }]);
        
        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, model: selectedModel })
            });
            
            const data = await response.json();
            
            if (data.response) {
                setMessages(prev => [...prev, { role: 'assistant', content: data.response }]);
            } else {
                alert('Ошибка: ' + data.error);
            }
        } catch (error) {
            alert('Ошибка соединения');
        }
        
        setMessage('');
        setLoading(false);
    };

    return (
        <div className="chat-container">
            <div className="model-selector">
                <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)}>
                    {models.map(model => (
                        <option key={model.name} value={model.name}>
                            {model.provider} - {model.name}
                        </option>
                    ))}
                </select>
            </div>
            
            <div className="messages">
                {messages.map((msg, index) => (
                    <div key={index} className={`message ${msg.role}`}>
                        <strong>{msg.role === 'user' ? 'Вы' : 'AI'}:</strong>
                        <p>{msg.content}</p>
                    </div>
                ))}
            </div>
            
            <div className="input-area">
                <input
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Введите сообщение..."
                    onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                />
                <button onClick={sendMessage} disabled={loading}>
                    {loading ? 'Отправка...' : 'Отправить'}
                </button>
            </div>
        </div>
    );
};
```

## 🔍 Поисковая система с эмбеддингами

### Структура проекта:
```
smart-search/
├── client-module/          # Скопированный модуль
├── src/
│   ├── indexer.py         # Индексация документов
│   ├── searcher.py        # Поиск по векторам
│   └── main.py            # Главное приложение
├── data/
│   └── documents/         # Документы для индексации
└── .env
```

### Индексация документов:
```python
# src/indexer.py
import os
import sys
import numpy as np
from pathlib import Path

# Добавляем путь к модулю
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'client-module', 'python_client'))
from client import GitHubModelsClient

class DocumentIndexer:
    def __init__(self):
        self.client = GitHubModelsClient()
        self.embeddings = {}
        
    def index_documents(self, docs_folder):
        """Индексирует все документы в папке"""
        for file_path in Path(docs_folder).glob('*.txt'):
            print(f"Индексирую: {file_path.name}")
            
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Получаем эмбеддинг
            result = self.client.get_embedding(
                model="openai/text-embedding-3-large",
                input_text=content
            )
            
            if result['success']:
                self.embeddings[file_path.name] = {
                    'content': content,
                    'vector': np.array(result['embeddings'][0])
                }
                print(f"✅ {file_path.name} проиндексирован")
            else:
                print(f"❌ Ошибка с {file_path.name}: {result['error']}")
    
    def save_index(self, index_file='index.npz'):
        """Сохраняет индекс на диск"""
        vectors = {}
        contents = {}
        
        for filename, data in self.embeddings.items():
            vectors[filename] = data['vector']
            contents[filename] = data['content']
        
        np.savez(index_file, **vectors)
        
        with open('contents.json', 'w', encoding='utf-8') as f:
            import json
            json.dump(contents, f, ensure_ascii=False, indent=2)
        
        print(f"Индекс сохранен: {len(self.embeddings)} документов")

# Использование
if __name__ == "__main__":
    indexer = DocumentIndexer()
    indexer.index_documents('data/documents')
    indexer.save_index()
```

### Поиск по документам:
```python
# src/searcher.py
import sys
import os
import numpy as np
import json
from sklearn.metrics.pairwise import cosine_similarity

sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'client-module', 'python_client'))
from client import GitHubModelsClient

class SmartSearcher:
    def __init__(self, index_file='index.npz', contents_file='contents.json'):
        self.client = GitHubModelsClient()
        
        # Загружаем индекс
        self.vectors = dict(np.load(index_file))
        
        with open(contents_file, 'r', encoding='utf-8') as f:
            self.contents = json.load(f)
    
    def search(self, query, top_k=5):
        """Поиск документов по запросу"""
        print(f"Поиск: '{query}'")
        
        # Получаем эмбеддинг запроса
        result = self.client.get_embedding(
            model="openai/text-embedding-3-large",
            input_text=query
        )
        
        if not result['success']:
            return f"Ошибка получения эмбеддинга: {result['error']}"
        
        query_vector = np.array(result['embeddings'][0]).reshape(1, -1)
        
        # Считаем сходство со всеми документами
        similarities = {}
        for filename, doc_vector in self.vectors.items():
            doc_vector = doc_vector.reshape(1, -1)
            similarity = cosine_similarity(query_vector, doc_vector)[0][0]
            similarities[filename] = similarity
        
        # Сортируем по убыванию сходства
        sorted_results = sorted(similarities.items(), key=lambda x: x[1], reverse=True)
        
        # Возвращаем топ результатов
        results = []
        for filename, score in sorted_results[:top_k]:
            results.append({
                'filename': filename,
                'score': score,
                'content': self.contents[filename][:200] + '...'  # Превью
            })
        
        return results

# Использование
if __name__ == "__main__":
    searcher = SmartSearcher()
    
    query = input("Введите поисковый запрос: ")
    results = searcher.search(query)
    
    print("\n🔍 Результаты поиска:")
    for i, result in enumerate(results, 1):
        print(f"\n{i}. {result['filename']} (сходство: {result['score']:.3f})")
        print(f"   {result['content']}")
```

## 🤖 Telegram бот

### Структура проекта:
```
telegram-ai-bot/
├── client-module/          # Скопированный модуль
├── bot.py                 # Главный файл бота
├── requirements.txt       # python-telegram-bot
└── .env                   # TELEGRAM_TOKEN, GITHUB_MODELS_PROXY_URL
```

### Telegram бот:
```python
# bot.py
import os
import sys
import logging
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, CallbackQueryHandler, filters, ContextTypes

# Добавляем путь к модулю
sys.path.append(os.path.join(os.path.dirname(__file__), 'client-module', 'python_client'))
from client import GitHubModelsClient

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Инициализация AI клиента
ai_client = GitHubModelsClient()

class TelegramAIBot:
    def __init__(self):
        self.user_models = {}  # Модель для каждого пользователя
        
    async def start(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Команда /start"""
        user_id = update.effective_user.id
        self.user_models[user_id] = "openai/gpt-4o-mini"  # Модель по умолчанию
        
        welcome_text = """
🤖 Добро пожаловать в AI Бот!

Доступные команды:
/start - Начать работу
/models - Выбрать модель
/help - Помощь

Просто отправьте мне сообщение, и я отвечу! 🚀
        """
        
        await update.message.reply_text(welcome_text)
    
    async def show_models(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Команда /models - показать доступные модели"""
        models = ai_client.get_models(model_type="chat")
        
        # Создаем инлайн клавиатуру с моделями
        keyboard = []
        for i in range(0, len(models), 2):  # По 2 кнопки в ряд
            row = []
            for j in range(2):
                if i + j < len(models):
                    model = models[i + j]
                    button_text = f"{model['provider']} - {model['name'].split('/')[-1]}"
                    callback_data = f"model_{model['name']}"
                    row.append(InlineKeyboardButton(button_text, callback_data=callback_data))
            keyboard.append(row)
        
        reply_markup = InlineKeyboardMarkup(keyboard)
        await update.message.reply_text("Выберите модель:", reply_markup=reply_markup)
    
    async def model_callback(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработка выбора модели"""
        query = update.callback_query
        await query.answer()
        
        user_id = update.effective_user.id
        model_name = query.data.replace("model_", "")
        self.user_models[user_id] = model_name
        
        provider = model_name.split('/')[0]
        model_short = model_name.split('/')[-1]
        
        await query.edit_message_text(f"✅ Модель изменена на: {provider} - {model_short}")
    
    async def handle_message(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Обработка обычных сообщений"""
        user_id = update.effective_user.id
        user_message = update.message.text
        
        # Получаем модель пользователя
        model = self.user_models.get(user_id, "openai/gpt-4o-mini")
        
        # Показываем индикатор печати
        await context.bot.send_chat_action(chat_id=update.effective_chat.id, action='typing')
        
        try:
            # Отправляем запрос к AI
            result = ai_client.chat_completion(
                model=model,
                messages=[{"role": "user", "content": user_message}]
            )
            
            if result['success']:
                response = result['content']
                
                # Добавляем информацию о модели
                model_info = f"\n\n_Модель: {model}_"
                
                await update.message.reply_text(
                    response + model_info, 
                    parse_mode='Markdown'
                )
            else:
                await update.message.reply_text(f"❌ Ошибка: {result['error']}")
                
        except Exception as e:
            logger.error(f"Ошибка обработки сообщения: {e}")
            await update.message.reply_text("🛠 Произошла техническая ошибка. Попробуйте позже.")
    
    async def help_command(self, update: Update, context: ContextTypes.DEFAULT_TYPE):
        """Команда /help"""
        help_text = """
🆘 **Помощь по боту**

**Команды:**
/start - Начать работу с ботом
/models - Выбрать AI модель для общения
/help - Показать эту справку

**Как пользоваться:**
1. Отправьте любое сообщение
2. Бот ответит используя выбранную AI модель
3. Используйте /models для смены модели

**Доступные провайдеры:**
• OpenAI (GPT-4o, GPT-4o-mini, O1, O3)
• Microsoft (Phi-3, Phi-4, MAI)
• Meta (Llama 3.1, Llama 3.3)
• Mistral AI (Mistral Large, Codestral)
• И другие...

Всего доступно **58 моделей**! 🚀
        """
        
        await update.message.reply_text(help_text, parse_mode='Markdown')

def main():
    """Запуск бота"""
    # Получаем токен из переменных окружения
    token = os.getenv('TELEGRAM_TOKEN')
    if not token:
        logger.error("Не найден TELEGRAM_TOKEN в переменных окружения")
        return
    
    # Создаем приложение
    app = Application.builder().token(token).build()
    bot = TelegramAIBot()
    
    # Добавляем обработчики
    app.add_handler(CommandHandler("start", bot.start))
    app.add_handler(CommandHandler("models", bot.show_models))
    app.add_handler(CommandHandler("help", bot.help_command))
    app.add_handler(CallbackQueryHandler(bot.model_callback, pattern="^model_"))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, bot.handle_message))
    
    # Запускаем бота
    logger.info("🤖 Бот запущен!")
    app.run_polling()

if __name__ == "__main__":
    main()
```

### requirements.txt:
```
python-telegram-bot==20.7
python-dotenv==1.0.0
```

### .env файл:
```env
TELEGRAM_TOKEN=your_telegram_bot_token
GITHUB_MODELS_PROXY_URL=http://localhost:3010/v1
```

## 📱 CLI инструмент

### Структура проекта:
```
ai-cli-tool/
├── client-module/          # Скопированный модуль
├── ai_cli.py              # CLI инструмент
└── .env
```

### CLI инструмент:
```python
# ai_cli.py
#!/usr/bin/env python3
import sys
import os
import argparse

sys.path.append(os.path.join(os.path.dirname(__file__), 'client-module', 'python_client'))
from client import GitHubModelsClient

def main():
    parser = argparse.ArgumentParser(description='AI CLI Tool - работа с 58 моделями GitHub Models')
    
    subparsers = parser.add_subparsers(dest='command', help='Доступные команды')
    
    # Команда chat
    chat_parser = subparsers.add_parser('chat', help='Общение с AI моделью')
    chat_parser.add_argument('message', help='Сообщение для AI')
    chat_parser.add_argument('--model', '-m', default='openai/gpt-4o-mini', help='Модель для использования')
    
    # Команда embed
    embed_parser = subparsers.add_parser('embed', help='Получить эмбеддинг текста')
    embed_parser.add_argument('text', help='Текст для векторизации')
    embed_parser.add_argument('--model', '-m', default='openai/text-embedding-3-large', help='Модель для эмбеддинга')
    
    # Команда models
    models_parser = subparsers.add_parser('models', help='Показать доступные модели')
    models_parser.add_argument('--provider', '-p', help='Фильтр по провайдеру')
    models_parser.add_argument('--type', '-t', help='Фильтр по типу (chat, embedding, vision, etc.)')
    
    # Команда test
    test_parser = subparsers.add_parser('test', help='Тестировать модели')
    test_parser.add_argument('--limit', '-l', type=int, default=5, help='Количество моделей для теста')
    test_parser.add_argument('--message', '-msg', default='Привет!', help='Тестовое сообщение')
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        return
    
    # Инициализируем клиент
    client = GitHubModelsClient()
    
    if args.command == 'chat':
        print(f"🤖 Модель: {args.model}")
        print(f"💬 Запрос: {args.message}")
        print("⏳ Обработка...")
        
        result = client.chat_completion(
            model=args.model,
            messages=[{"role": "user", "content": args.message}]
        )
        
        if result['success']:
            print(f"\n✅ Ответ:\n{result['content']}")
        else:
            print(f"\n❌ Ошибка: {result['error']}")
    
    elif args.command == 'embed':
        print(f"🔢 Модель: {args.model}")
        print(f"📝 Текст: {args.text}")
        print("⏳ Векторизация...")
        
        result = client.get_embedding(
            model=args.model,
            input_text=args.text
        )
        
        if result['success']:
            vector = result['embeddings'][0]
            print(f"\n✅ Эмбеддинг получен:")
            print(f"   Размерность: {len(vector)}")
            print(f"   Первые 5 значений: {vector[:5]}")
        else:
            print(f"\n❌ Ошибка: {result['error']}")
    
    elif args.command == 'models':
        models = client.get_models(
            provider=args.provider,
            model_type=args.type
        )
        
        print(f"\n📋 Найдено моделей: {len(models)}")
        
        # Группируем по провайдерам
        by_provider = {}
        for model in models:
            provider = model['provider']
            if provider not in by_provider:
                by_provider[provider] = []
            by_provider[provider].append(model)
        
        for provider, provider_models in by_provider.items():
            print(f"\n🏢 {provider} ({len(provider_models)} моделей):")
            for model in provider_models:
                print(f"   • {model['name']} - {model['type']}")
    
    elif args.command == 'test':
        print(f"🧪 Тестирование {args.limit} моделей...")
        print(f"💬 Тестовое сообщение: '{args.message}'")
        print("⏳ Запуск тестов...\n")
        
        results = client.test_all_models(
            model_type="chat",
            limit=args.limit,
            test_message=args.message,
            delay_between_requests=1.0
        )
        
        print("\n📊 Результаты тестирования:")
        success_count = sum(1 for r in results if r['success'])
        print(f"✅ Успешно: {success_count}/{len(results)}")
        
        for result in results:
            status = "✅" if result['success'] else "❌"
            print(f"{status} {result['model']}")
            if not result['success']:
                print(f"   Ошибка: {result['error']}")

if __name__ == "__main__":
    main()
```

### Использование CLI:
```bash
# Простое общение
python ai_cli.py chat "Как дела?"

# Выбор модели
python ai_cli.py chat "Объясни квантовую физику" --model "openai/o1-preview"

# Получение эмбеддинга
python ai_cli.py embed "Машинное обучение" --model "openai/text-embedding-3-large"

# Просмотр моделей
python ai_cli.py models
python ai_cli.py models --provider OpenAI
python ai_cli.py models --type embedding

# Тестирование
python ai_cli.py test --limit 3 --message "Привет, как дела?"
```

## 🚀 Готовые решения

Все эти примеры демонстрируют:

✅ **Простую интеграцию** - скопировал модуль и используй  
✅ **Безопасность** - токены скрыты, клиенты не знают о них  
✅ **Надежность** - автоматические повторы при ошибках  
✅ **Масштабируемость** - от простого чата до поисковых систем  
✅ **Универсальность** - веб, мобильные, CLI, боты  

**Адаптируйте под свои нужды и создавайте потрясающие AI приложения!** 🎉
