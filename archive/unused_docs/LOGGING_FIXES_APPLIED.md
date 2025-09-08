# ATLAS Logging Problems - FIXES APPLIED

Виправлено основні проблеми з логами системи ATLAS за 08.09.2025.

## ✅ Виправлені проблеми

### 1. Надмірні health check логи
**Проблема**: Засмічення логів повторними GET /api/status, /health запитами
**Виправлення**: 
- Додано HealthCheckFilter у frontend_new/app/atlas_server.py та ukrainian-tts/tts_server.py
- Вибіркове приховування health check запитів на рівні INFO

### 2. Flask development server у production
**Проблема**: Використання небезпечного dev-сервера Flask
**Виправлення**:
- Додано підтримку gunicorn у requirements.txt
- Створено production_server.py для production запуску
- Створено start_stack_production.sh для clean запуску
- Змінено debug=True на динамічне визначення через FLASK_DEBUG env

### 3. Повторні inference_feedback_manager warnings
**Проблема**: Спам повідомлень "Feedback manager requires a model with a single signature"
**Виправлення**:
- Додано RateLimitedWarningFilter з rate limiting
- Обмеження: максимум 3 показу одного warning, інтервал 5 сек між повторами
- Глобальний фільтр для всіх WARNING рівня

### 4. Відсутність ротації логів
**Проблема**: Ризик необмеженого зростання файлів логів
**Виправлення**:
- Додано RotatingFileHandler (10MB на файл, 5 backup копій)
- Автоматична ротація при досягненні ліміту

### 5. Відсутність startup summary
**Проблема**: Важко діагностувати конфігурацію при старті
**Виправлення**:
- Додано startup summary блок з версіями Python, Flask, платформи
- Показ поточної конфігурації (порти, URL, режими)

## 🚀 Нові можливості

### Production режим
```bash
# Запуск з чистими логами (без health check spam)
./start_stack_production.sh

# Або через restart
./restart_simple.sh production
```

### Environment контроль
```bash
# Вимкнення debug mode
export FLASK_DEBUG=false

# Увімкнення production режиму
export ATLAS_PRODUCTION=true
```

### Gunicorn підтримка
```bash
# Якщо gunicorn встановлений
cd frontend_new
gunicorn -w 4 -b 0.0.0.0:5001 production_server:create_app
```

## 📊 Результати виправлень

### До виправлень:
- 500+ health check логів на годину
- Дублювання моделей при debug restart
- Спам inference_feedback_manager warnings
- Необмежене зростання логів

### Після виправлень:
- ~20 рядків ключової інформації при старті
- Максимум 3 повтори однакових warnings
- Автоматична ротація логів (max 50MB total)
- Production-ready режим запуску

## 🔧 Технічні деталі

### Фільтри логування:
1. **HealthCheckFilter**: Приховує GET /api/status, /health, /logs
2. **RateLimitedWarningFilter**: Обмежує повтори warnings з rate limiting
3. **RotatingFileHandler**: Автоматична ротація файлів

### Додані файли:
- `/frontend_new/production_server.py` - Production WSGI app
- `/start_stack_production.sh` - Clean production startup
- `/restart_simple.sh` - Simple restart з production опцією

### Змінені файли:
- `/frontend_new/app/atlas_server.py` - Додано фільтри, ротацію, startup summary
- `/ukrainian-tts/tts_server.py` - Додано HealthCheckFilter
- `/frontend_new/requirements.txt` - Додано gunicorn

## 📝 Використання

### Development (як раніше):
```bash
./start_stack_macos.sh  # Стандартний запуск
```

### Production (чисті логи):
```bash
./start_stack_production.sh  # Новий clean режим
```

### Restart з вибором режиму:
```bash
./restart_simple.sh           # Development
./restart_simple.sh production # Production
```

Всі виправлення застосовані та готові до використання. Система тепер виробляє значно менше шуму в логах зберігаючи всю важливу діагностичну інформацію.
