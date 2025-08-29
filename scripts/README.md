# 🤖 Goose Monitoring Tools

Зручні утиліти для моніторингу сесій Goose AI Agent.

## 🚀 Швидкий старт

```bash
# Показати останні записи з найсвіжішої сесії
./scripts/goose-monitor

# Real-time моніторинг (оновлення кожні 3 секунди)
./scripts/goose-monitor live

# Список всіх сесій
./scripts/goose-monitor list

# Довідка
./scripts/goose-monitor help
```

## 📋 Доступні команди

| Команда | Короткий варіант | Опис |
|---------|------------------|------|
| `latest` | `l` | Показати останні 50 записів з найсвіжішої сесії |
| `live` | `r` | Real-time моніторинг з автооновленням |
| `list` | `ls` | Список всіх сесій з розмірами та датами |
| `help` | `h` | Показати довідку |

## 🔍 Ручні команди

Якщо потрібно більше контролю:

```bash
# Останні записи без скриптів
cd ~/.local/share/goose/sessions/
tail -50 "$(ls -t *.jsonl | head -1)"

# Автоматичне слідкування за найновішим файлом
tail -f "$(ls -t ~/.local/share/goose/sessions/*.jsonl | head -1)"

# Показати 5 найновіших сесій
ls -lt ~/.local/share/goose/sessions/*.jsonl | head -5
```

## 📊 Приклад виводу

```
🔍 Пошук найсвіжішої сесії Goose...
📂 Найсвіжіша сесія: відео_20250829_221134.jsonl
⏰ Час модифікації: Aug 29 22:18:50 2025
📊 Розмір: 164KB

📖 Останні 50 записів:
─────────────────────────────────────────────────────
{"working_dir":"/path/to/dir","description":"Video search task"...}
```

## 🎯 Інтеграція з Atlas

Ці інструменти працюють разом з:
- 🌐 **Atlas Frontend**: http://localhost:8080
- ⚡ **Temporal UI**: http://localhost:8233
- 🤖 **Goose Agent**: port 3000
