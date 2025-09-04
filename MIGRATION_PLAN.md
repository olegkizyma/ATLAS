# ATLAS Migration Plan

## Цель миграции
Реализация 3-агентной системы ATLAS согласно технической спецификации:
- Atlas (Куратор/Стратег) 
- Tetiana/Goose (Выполнитель)
- Grisha (Контролер/Валидатор)

## План миграции

### Этап 1: Архивация существующего кода
- [x] Создать папку `old`
- [ ] Переместить все файлы из `frontend_new`, кроме веб-интерфейса
- [ ] Сохранить дизайн веб-интерфейса (templates/, static/css/, static/assets/)

### Этап 2: Анализ веб-интерфейса
Сохранить для будущего использования:
- `frontend_new/app/templates/index.html` - основной HTML шаблон
- `frontend_new/app/static/css/main.css` - стили интерфейса
- `frontend_new/app/static/assets/` - графические ресурсы
- `frontend_new/app/static/js/` - клиентская логика

### Этап 3: Создание новой backend системы
Разработка нового backend с:
- Prompt-driven архитектурой (без жестко закодированных правил)
- 7-этапным циклом взаимодействия агентов
- Системой вето Grisha
- Сессионным режимом для критических ситуаций

### Этап 4: Интеграция агентов
- Atlas: планирование и координация
- Tetiana: выполнение через Goose desktop
- Grisha: контроль качества и безопасности

## Файлы для архивации
- `frontend_new/app/atlas_server.py` → `old/atlas_server.py`
- `frontend_new/orchestrator/` → `old/orchestrator/`
- `frontend_new/config/` → `old/config/`
- `frontend_new/app/api/` → `old/app/api/`
- `frontend_new/app/core/` → `old/app/core/`

## Файлы для сохранения (веб-интерфейс)
- `frontend_new/app/templates/` - СОХРАНИТЬ
- `frontend_new/app/static/css/` - СОХРАНИТЬ
- `frontend_new/app/static/assets/` - СОХРАНИТЬ
- `frontend_new/app/static/js/` - СОХРАНИТЬ (клиентская логика)