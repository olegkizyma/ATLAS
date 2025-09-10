# ATLAS Complete Logging System

Повноцінна система логування та моніторингу для ATLAS з підсвіткою помилок, централізованим збором логів та інтерактивним інтерфейсом.

## 🚀 Швидкий старт

```bash
# Запуск інтерактивного меню
./atlas_logging.sh

# Швидкий перегляд всіх логів
./atlas_logging.sh --all

# Перегляд тільки помилок
./atlas_logging.sh --errors

# Початок централізованого логування
./atlas_logging.sh -c start
```

## 📁 Структура системи

```
logging_system/
├── atlas_logging.sh         # Головний інтерфейс
├── log_monitor.sh           # Інтерактивний моніторинг логів
├── centralized_logging.sh   # Централізований збір логів
├── log_monitor.conf         # Конфігурація
└── README.md               # Ця документація
```

## 🔧 Компоненти системи

### 1. Інтерактивний моніторинг (`log_monitor.sh`)

**Особливості:**
- 🎨 Кольорова підсвітка помилок, попереджень, інформації
- 🔍 Пошук по всіх логах
- 📊 Статистика логів (розмір, кількість помилок)
- 🗂️ Фільтрація по сервісам
- 📦 Архівування старих логів
- 🧹 Очищення логів

**Використання:**
```bash
./log_monitor.sh                    # Інтерактивне меню
./log_monitor.sh --all              # Стрім всіх логів
./log_monitor.sh --errors           # Тільки помилки
./log_monitor.sh --service frontend # Конкретний сервіс
./log_monitor.sh --stats            # Статистика
```

### 2. Централізоване логування (`centralized_logging.sh`)

**Особливості:**
- 📡 Збір логів з усіх сервісів в один файл
- 📊 Моніторинг статусу сервісів
- 🔄 Автоматичне відстеження змін
- 📝 Unified log format
- ⚡ Real-time aggregation

**Використання:**
```bash
./centralized_logging.sh start     # Запуск
./centralized_logging.sh stop      # Зупинка  
./centralized_logging.sh status    # Статус
./centralized_logging.sh tail      # Перегляд unified log
./centralized_logging.sh restart   # Перезапуск
```

### 3. Головний інтерфейс (`atlas_logging.sh`)

**Інтерактивне меню з опціями:**
1. 📡 Interactive log viewer
2. 🔍 Watch all logs (stream)
3. 🚨 Watch errors only
4. 🎯 Watch specific service
5. 🔄 Start centralized logging
6. 🛑 Stop centralized logging
7. 📊 Show logging system status
8. 📄 Watch unified log
9. ⚙️ Restart ATLAS with logging
10. 📊 Check ATLAS services status
11. 📦 Archive and clean logs

## 🎨 Кольорова підсвітка

- 🔴 **Червоний**: ERROR, CRITICAL, Exception, Traceback
- 🟡 **Жовтий**: WARNING, WARN
- 🟢 **Зелений**: INFO, Starting, Started, Success
- ⚪ **Сірий**: DEBUG
- 🔵 **Синій**: Системні повідомлення

## 📊 Файли логів

### Основні логи:
- `frontend.log` - Головний веб-інтерфейс + Vision API
- `orchestrator.log` - Координатор агентів
- `tts_server.log` - Сервер синтезу мови
- `goose.log` - AI асистент
- `recovery_bridge.log` - Міст відновлення WebSocket

### Системні логи:
- `atlas_unified.log` - Об'єднаний лог всіх сервісів
- `services_status.log` - Статус сервісів
- `*_monitor.pid` - PID файли моніторів

## ⚙️ Конфігурація

Файл `log_monitor.conf` містить:
- Шляхи до логів
- Кольорові схеми
- Фільтри для підсвітки
- Налаштування архівування
- Формати часових міток

## 🔍 Приклади використання

### Моніторинг помилок під час розробки:
```bash
./atlas_logging.sh --errors
```

### Перегляд логів конкретного сервісу:
```bash
./log_monitor.sh --service frontend   # Frontend + Vision API
./log_monitor.sh --service vision     # Тільки Vision API
./log_monitor.sh --service recovery   # Recovery Bridge WebSocket
```

### Запуск повної системи логування:
```bash
# Запуск централізованого логування
./centralized_logging.sh start

# Перегляд unified log
./centralized_logging.sh tail
```

### Архівування логів:
```bash
./log_monitor.sh
# Вибрати опцію 7 "Archive old logs"
```

## 📈 Можливості пошуку

В інтерактивному режимі доступний потужний пошук:
- 🔍 Пошук по ключовим словам
- 📊 Показ знайдених рядків з номерами
- 🎯 Пошук по всіх файлах логів одночасно

## 🚨 Моніторинг помилок

Система автоматично виділяє:
- **ERROR/CRITICAL** - червоним кольором
- **WARNING** - жовтим кольором  
- **Exception/Traceback** - червоним кольором
- **Failed/fail** - червоним кольором

## 📦 Архівування

Автоматичне архівування:
- Створення tar.gz архівів з timestamp
- Збереження в `logs/archive/`
- Опціональне очищення після архівування
- Підтримка ручного та автоматичного режимів

## 🔧 Інтеграція з ATLAS

Система повністю інтегрована з ATLAS:
- Автоматичне виявлення сервісів
- Підтримка всіх портів (5001, 5101, 5102, 3001, 3000)
- Синхронізація з `restart_simple.sh`
- Моніторинг health endpoints

## 🎯 Переваги

1. **Централізація** - всі логи в одному місці
2. **Візуалізація** - кольорова підсвітка важливих подій
3. **Інтерактивність** - зручне меню та навігація
4. **Автоматизація** - автоматичне архівування та моніторинг
5. **Гнучкість** - багато опцій фільтрації та перегляду
6. **Ефективність** - real-time моніторинг без затримок

Ця система логування перетворює моніторинг ATLAS з рутини в ефективний та зрозумілий процес! 🎉
