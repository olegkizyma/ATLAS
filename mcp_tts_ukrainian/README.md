# Ukrainian TTS MCP Server 🎙️🇺🇦

**Сервер Model Context Protocol (MCP) для українського озвучення тексту**

## Можливості

- ✅ **Українська TTS**: Підтримка robinhad/ukrainian-tts з голосами mykyta, oleksa, tetiana, lada
- 🌐 **Google TTS Fallback**: Автоматичне перемикання на Google TTS для інших мов
- 🎵 **Аудіо відтворення**: Вбудоване відтворення через pygame
- 🔧 **MCP інтеграція**: Повна сумісність з MCP протоколом

## Швидкий старт

### 1. Запуск сервера
```bash
cd /Users/dev/Documents/Atlas-mcp/mcp_tts_ukrainian
./start.sh
```

### 2. Тестування
```bash
python test_tts.py
```

## Доступні інструменти

### `say_tts`
Озвучування тексту з підтримкою різних голосів та мов

**Параметри:**
- `text` (обов'язковий): Текст для озвучування
- `voice` (опціонально): Голос для української TTS (mykyta, oleksa, tetiana, lada)
- `lang` (опціонально): Код мови (uk, en, ru)
- `rate` (опціонально): Швидкість мовлення (для сумісності)

**Приклад:**
```json
{
  "tool": "say_tts",
  "arguments": {
    "text": "Привіт! Як справи?",
    "voice": "mykyta",
    "lang": "uk"
  }
}
```

### `list_voices`
Отримання списку доступних голосів

### `tts_status`
Перевірка статусу TTS движків

## Налаштування для MCP клієнтів

### VS Code (MCP Extension)
Додайте до налаштувань MCP:

```json
{
  "mcpServers": {
    "ukrainian-tts": {
      "command": "/bin/bash",
      "args": ["/Users/dev/Documents/Atlas-mcp/mcp_tts_ukrainian/start.sh"],
      "transport": {
        "type": "stdio"
      }
    }
  }
}
```

### Goose AI
```bash
# У конфігурації Goose додайте:
[extensions.ukrainian-tts]
command = "/bin/bash"
args = ["/Users/dev/Documents/Atlas-mcp/mcp_tts_ukrainian/start.sh"]
```

## Структура проекту

```
mcp_tts_ukrainian/
├── mcp_tts_server.py    # Головний MCP сервер
├── start.sh             # Скрипт запуску
├── test_tts.py          # Тестовий скрипт
├── requirements.txt     # Python залежності
├── config.yaml          # Конфігурація TTS
├── model.pth            # Модель ukrainian-tts
├── spk_xvector.ark      # Голосові вектори
├── feats_stats.npz      # Статистики фічів
└── mcp_config.json      # Конфігурація MCP
```

## Залежності

- `ukrainian-tts` - Основний TTS движок
- `torch` + `torchaudio` - PyTorch для нейронних мереж
- `gtts` - Google TTS для fallback
- `pygame` - Аудіо відтворення
- `mcp` - Model Context Protocol

## Підтримувані голоси

### Українські (ukrainian-tts)
- **mykyta** - чоловічий голос
- **oleksa** - чоловічий голос  
- **tetiana** - жіночий голос
- **lada** - жіночий голос

### Інші мови (Google TTS)
- Англійська (en)
- Російська (ru)
- Та багато інших

## Приклади використання

### В Python
```python
import asyncio
from mcp_tts_server import UkrainianTTSEngine

async def example():
    engine = UkrainianTTSEngine()
    
    # Українська TTS
    result = await engine.speak("Привіт світ!", "mykyta", "uk")
    print(result)
    
    # English fallback
    result = await engine.speak("Hello world!", "default", "en")
    print(result)

asyncio.run(example())
```

### Через MCP клієнт
```bash
echo '{"method":"tools/call","params":{"name":"say_tts","arguments":{"text":"Слава Україні!","voice":"tetiana"}}}' | python mcp_tts_server.py
```

## Виправлення проблем

### Ukrainian TTS не працює
- Перевірте, що встановлено всі залежності: `pip install -r requirements.txt`
- Переконайтесь, що файли моделі завантажені в папку
- Спробуйте перезапустити сервер

### Звук не відтворюється  
- Перевірте, що pygame ініціалізовано правильно
- Переконайтесь, що система має аудіо вихід
- Спробуйте тест: `python test_tts.py`

### MCP клієнт не підключається
- Перевірте правильність шляху в конфігурації
- Переконайтесь, що сервер запущено
- Перевірте логи сервера

## Автор

**Atlas AI Team**  
Базується на [robinhad/ukrainian-tts](https://github.com/robinhad/ukrainian-tts)

## Ліцензія

MIT License
