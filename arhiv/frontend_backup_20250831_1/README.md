# ATLAS Frontend

Мінімалістичний хакерський інтерфейс для системи ATLAS з підтримкою живих логів та 3D-візуалізації.

## 🚀 Швидкий старт

### Перше налаштування
```bash
# Створення та налаштування віртуального середовища
./setup_env.sh
```

### Запуск
```bash
# Інтерактивний режим
./start_frontend.sh

# Фоновий режим
./start_frontend.sh --background
```

## 📦 Структура файлів

```
frontend/
├── atlas_minimal_live.py      # Основний сервер
├── index.html                 # Головний інтерфейс
├── DamagedHelmet.glb          # 3D модель
├── requirements.txt           # Python залежності
├── setup_env.sh              # Налаштування середовища
├── start_frontend.sh          # Скрипт запуску
├── .env                       # Конфігурація
├── venv/                      # Віртуальне середовище
└── README.md                  # Ця документація
```

## ⚙️ Конфігурація

Налаштування в файлі `.env`:
- `FRONTEND_PORT` - порт веб-сервера (за замовчуванням 8080)
- `GOOSED_PORT` - порт API goosed (за замовчуванням 3000)
- `DEBUG` - режим відладки
- `UI_LANGUAGE` - мова інтерфейсу

## 🌐 Доступ

- **Веб-інтерфейс**: http://localhost:8080
- **API endpoint**: http://localhost:3000

## 🔧 Функції

- ✅ 3D-візуалізація з WebGL
- ✅ Живі логи MCP в реальному часі
- ✅ Хакерський термінальний інтерфейс
- ✅ Голосове управління
- ✅ Підтримка чату
- ✅ Віртуальне Python середовище

## 🛠️ Розробка

### Активація середовища
```bash
source venv/bin/activate
```

### Встановлення нових залежностей
```bash
pip install package_name
pip freeze > requirements.txt
```

### Деактивація середовища
```bash
deactivate
```

## 📋 Залежності

- Python 3.11+
- requests >= 2.32.0
- Стандартна бібліотека Python

## 🐛 Troubleshooting

### Проблема з модулем requests
```bash
./setup_env.sh
```

### Порт зайнятий
Змініть `FRONTEND_PORT` в `.env` або зупиніть процес:
```bash
pkill -f atlas_minimal_live
```

### Перевірка статусу
```bash
curl http://localhost:8080
```
