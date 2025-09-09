# ATLAS Vision + Goose Integration

Інтеграція комп'ютерного зору ATLAS з системою Goose для розширених можливостей обробки зображень та моніторингу.

## Огляд

Цей модуль об'єднує:
- **VisionProcessor** - обробка зображень, детекція об'єктів, людей, рук, облич
- **GrishaVisionMonitor** - моніторинг екрану та фіксація активності
- **GooseVisionIntegration** - інтеграція з Goose для природної мови та автоматизації

## Можливості

### 1. Аналіз зображень
- Детекція об'єктів через YOLO
- Розпізнавання людей, рук, облич через MediaPipe
- Покращення якості зображень
- Генерація послідовностей дій

### 2. Моніторинг екрану
- Автоматичні скріншоти
- Моніторинг активності
- Візуальні докази для верифікації

### 3. Goose інтеграція
- Природна мова для управління vision tools
- Автоматизовані сценарії
- Розширення можливостей через chat

## Швидкий старт

### Базове використання

```python
import asyncio
from vision_processor import (
    setup_vision_with_goose,
    analyze_image_with_goose,
    get_vision_tools_status
)

async def quick_start():
    # Налаштування інтеграції
    await setup_vision_with_goose()
    
    # Аналіз зображення
    result = await analyze_image_with_goose(
        "data:image/jpeg;base64,/9j/4AAQSkZJRgABA...",
        "Що зображено на цій картинці?"
    )
    print(result)

asyncio.run(quick_start())
```

### Прямий доступ до tools

```python
from vision_processor import vision_processor, goose_vision_integration

# Обробка зображення
result = vision_processor.process_image_upload(image_data)

# Vision analysis через Goose
analysis_result = goose_vision_integration.execute_vision_analysis({
    "image_data": image_data,
    "analysis_type": "full"
})

# Screenshot
screenshot_result = goose_vision_integration.execute_screenshot_monitor({
    "action": "capture"
})
```

## Доступні Tools

### 1. vision_analysis

Аналізує зображення з використанням комп'ютерного зору.

**Параметри:**
- `image_data` (string, required) - Base64 зображення або шлях до файлу
- `analysis_type` (string) - Тип аналізу: "full", "objects", "people", "hands", "faces"
- `enhance_image` (boolean) - Чи покращувати якість зображення

**Приклад:**
```json
{
  "name": "vision_analysis",
  "arguments": {
    "image_data": "data:image/jpeg;base64,/9j/4AAQ...",
    "analysis_type": "full",
    "enhance_image": true
  }
}
```

### 2. screenshot_monitor

Робить скріншоти та моніторить активність екрану.

**Параметри:**
- `action` (string, required) - Дія: "start", "stop", "capture", "status"
- `task_description` (string) - Опис завдання для моніторингу
- `duration` (number) - Тривалість моніторингу в секундах
- `interval` (number) - Інтервал між скріншотами

**Приклад:**
```json
{
  "name": "screenshot_monitor",
  "arguments": {
    "action": "capture"
  }
}
```

## Сценарії використання

### 1. Автоматичний аналіз UI

```python
async def analyze_ui():
    # Зробити скріншот поточного стану
    await goose_vision_integration.chat_with_vision(
        "Зроби скріншот і проаналізуй інтерфейс користувача"
    )
```

### 2. Моніторинг виконання завдань

```python
async def monitor_task():
    # Розпочати моніторинг
    await goose_vision_integration.chat_with_vision(
        "Розпочни моніторинг виконання завдання 'копіювання файлів' на 60 секунд"
    )
```

### 3. Аналіз завантажених зображень

```python
async def analyze_uploaded_image(image_data):
    response = await analyze_image_with_goose(
        image_data,
        "Проаналізуй це зображення детально. Які об'єкти ти бачиш? Чи є там люди?"
    )
    return response
```

## Налаштування

### Вимоги

```bash
# Основні залежності
pip install opencv-python pillow numpy

# MediaPipe для розпізнавання
pip install mediapipe

# YOLO для детекції об'єктів
pip install ultralytics

# Screenshot capability
pip install pyautogui

# HTTP клієнт для Goose
pip install httpx
```

### Конфігурація Goose

```python
# В vision_processor.py
GOOSE_HOST = "127.0.0.1"
GOOSE_PORT = "3001"
SECRET_KEY = "test"
```

### Структура директорій

```
frontend_new/app/
├── vision_processor.py          # Основний модуль
├── test_vision_goose_integration.py  # Тести
└── temp/                        # Тимчасові файли (автоматично)
    ├── screenshots/
    ├── enhanced_images/
    └── analysis_results/
```

## Тестування

```bash
# Запустити тести інтеграції
cd frontend_new/app
python test_vision_goose_integration.py

# Запустити приклад використання
python vision_processor.py
```

## Логування

```python
import logging

# Включити детальне логування
logging.getLogger('atlas.vision').setLevel(logging.DEBUG)
```

## Поширені проблеми

### 1. Goose недоступний
```
❌ Goose integration setup failed
```
**Рішення:** Переконайтеся, що Goose server запущений на порті 3001

### 2. Відсутні залежності
```
ImportError: No module named 'cv2'
```
**Рішення:** Встановіть відповідні пакети через pip

### 3. Проблеми з правами доступу
```
Permission denied when saving screenshots
```
**Рішення:** Надайте дозволи на доступ до екрану в налаштуваннях системи

## Розширення

### Додавання нових vision tools

```python
# В GooseVisionIntegration
def execute_custom_tool(self, args: Dict[str, Any]) -> List[Dict[str, Any]]:
    # Ваша логіка
    pass

# Реєстрація в VISION_FRONTEND_CONFIG
CUSTOM_TOOL = {
    "name": "custom_tool",
    "description": "Custom vision functionality",
    "inputSchema": {...}
}
```

### Інтеграція з іншими системами

```python
# Експорт результатів
def export_analysis_results(analysis_data, format="json"):
    # Ваша логіка експорту
    pass
```

## API Reference

Детальна документація API доступна в docstrings кожного класу та методу у файлі `vision_processor.py`.
