# ATLAS - AI Assistant System 🚀🤖🇺🇦

**Комплексная система искусственного интеллекта с поддержкой украинского языка**

## 🎯 Компоненты системы

- **🤖 AI Agent** - Goose AI сервер (порт 3000)
- **🌐 Web Interface** - Минимальный хакерский интерфейс (порт 8080)  
- **🗣️ Ukrainian TTS** - Система синтеза украинской речи v6.0
- **📦 MCP Integration** - Model Context Protocol для расширений

## 🚀 Быстрый старт

### Запуск всей системы:
```bash
./start_atlas.sh
```

### Остановка системы:
```bash
./stop_atlas.sh
```

### Доступ к интерфейсам:
- **Веб-интерфейс:** http://localhost:8080
- **AI Agent API:** http://localhost:3000
- **Проверка здоровья:** http://localhost:3000/health

## 📋 Предварительные требования

### 1. Системные зависимости:
```bash
# macOS (Homebrew)
brew install rust python@3.11 node

# Ubuntu/Debian
sudo apt install build-essential python3 python3-venv nodejs npm
```

### 2. Python виртуальные окружения:

**Frontend:**
```bash
cd frontend/
python3 -m venv venv
source venv/bin/activate
pip install requests
```

**Ukrainian TTS:**
```bash
cd mcp_tts_ukrainian/
python3 -m venv tts_venv
source tts_venv/bin/activate
pip install git+https://github.com/robinhad/ukrainian-tts.git
```

### 3. Сборка AI Agent:
```bash
cd goose/
source bin/activate-hermit
cargo build --release -p goose-server
```

## 🗣️ Ukrainian TTS v6.0

### Доступные голоса:
- `mykyta` - мужской голос
- `oleksa` - мужской голос  
- `tetiana` - женский голос
- `lada` - женский голос

### API использования:
```python
from ukrainian_tts.tts import TTS
tts = TTS()
result = tts.tts(text="Слава Україні!", voice="mykyta", stress="model")
audio_buffer, response_text = result
```

## 📊 Мониторинг системы

### Проверка статуса:
```bash
# Проверка портов
lsof -i :3000,8080

# Проверка процессов
pgrep -f "goosed|atlas_minimal|mcp_tts"

# Проверка логов
tail -f /tmp/goose.log
tail -f /tmp/frontend.log  
tail -f /tmp/tts.log
```

## 🔧 Конфигурация

### Структура проекта:
```
ATLAS/
├── goose/               # AI Agent сервер (Rust)
├── frontend/            # Веб-интерфейс (Python)
├── mcp_tts_ukrainian/   # Ukrainian TTS (Python)
├── start_atlas.sh       # Запуск системы
├── stop_atlas.sh        # Остановка системы
└── README_ATLAS.md      # Эта документация
```

### Переменные окружения:
```bash
export ATLAS_HOST=0.0.0.0
export ATLAS_GOOSE_PORT=3000
export ATLAS_FRONTEND_PORT=8080
export ATLAS_TTS_VOICE=mykyta
```

## 🛠️ Разработка

### Отладка компонентов:

**AI Agent:**
```bash
cd goose/
source bin/activate-hermit
./target/release/goosed agent --verbose
```

**Frontend:**
```bash
cd frontend/
source venv/bin/activate
python3 atlas_minimal_live.py
```

**TTS Server:**
```bash
cd mcp_tts_ukrainian/
source tts_venv/bin/activate
python3 mcp_tts_server.py
```

## 📦 Архитектура

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Browser   │───▶│   Frontend      │───▶│   AI Agent      │
│   localhost:8080│    │   Python Flask  │    │   Goose Rust    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                │                       │
                                ▼                       ▼
                       ┌─────────────────┐    ┌─────────────────┐
                       │ Ukrainian TTS   │    │ MCP Extensions  │
                       │ v6.0 (espnet)   │    │ Context Protocol│
                       └─────────────────┘    └─────────────────┘
```

## 🎮 Использование

1. **Запустите систему:** `./start_atlas.sh`
2. **Откройте браузер:** http://localhost:8080
3. **Используйте чат** для взаимодействия с AI
4. **Наслаждайтесь** украинским синтезом речи
5. **Остановите:** `./stop_atlas.sh` или Ctrl+C

## 🔍 Устранение неполадок

### Проблемы с портами:
```bash
# Освободить занятые порты
sudo lsof -ti:3000 | xargs kill -9
sudo lsof -ti:8080 | xargs kill -9
```

### Проблемы с TTS:
```bash
# Переустановка Ukrainian TTS
cd mcp_tts_ukrainian/
rm -rf tts_venv/
python3 -m venv tts_venv
source tts_venv/bin/activate
pip install git+https://github.com/robinhad/ukrainian-tts.git
```

### Проблемы с Rust:
```bash
# Пересборка goose
cd goose/
source bin/activate-hermit
cargo clean
cargo build --release -p goose-server
```

## 📄 Лицензия

MIT License - см. файл LICENSE

---

**Atlas AI Team** 🇺🇦  
*Система для создания интеллектуальных ассистентов с поддержкой украинского языка*
