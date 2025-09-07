# Інтеграція Візуального Моніторингу Гриши

## Огляд

Система ATLAS тепер підтримує візуальний моніторинг для агента Гриши під час верифікації виконання завдань Тетяною. Ця функціональність дозволяє Гриші:

1. **Автоматично запускати моніторинг** коли Тетяна починає виконання завдання
2. **Захоплювати скріншоти** протягом всього процесу виконання
3. **Аналізувати візуальні докази** для підтвердження звітів Тетяни
4. **Включати візуальну інформацію** у процес верифікації

## Архітектура

### Компоненти

1. **GrishaVisionMonitor** (`frontend_new/app/vision_processor.py`)
   - Клас для захоплення та аналізу скріншотів
   - Фонове моніторингове завдання
   - Генерація візуальних доказів

2. **API Ендпоінти** (`frontend_new/app/atlas_server.py`)
   - `/api/grisha/start-monitoring` - Запуск моніторингу
   - `/api/grisha/stop-monitoring` - Зупинка моніторингу  
   - `/api/grisha/visual-evidence` - Отримання візуальних доказів
   - `/api/grisha/monitoring-status` - Статус моніторингу

3. **Оркестрація** (`frontend_new/orchestrator/server.js`)
   - Автоматичний запуск/зупинка моніторингу
   - Інтеграція візуальних доказів у верифікацію
   - Розширені результати верифікації

## Workflow

### 1. Автоматичний Запуск
```javascript
// В generateAgentResponse для Тетяни
if (agentType === 'tetyana' && enableTools) {
    await startGrishaVisualMonitoring();
    // ... виконання завдання ...
    await stopGrishaVisualMonitoring();
}
```

### 2. Захоплення Доказів
```python
class GrishaVisionMonitor:
    def _monitoring_loop(self):
        while self.is_monitoring:
            screenshot = pyautogui.screenshot()
            analysis = self._analyze_screenshot(screenshot)
            self.evidence.append({
                'timestamp': datetime.now().isoformat(),
                'type': analysis['type'],
                'description': analysis['description'],
                'objects': analysis.get('objects', []),
                'screenshot_path': screenshot_path
            })
```

### 3. Візуальна Верифікація
```javascript
// В grishaVerifyWithGoose
const visualEvidence = await getGrishaVisualEvidence();
const hasVisualEvidence = visualEvidence && visualEvidence.length > 0;

let visualEvidenceText = '';
if (hasVisualEvidence) {
    visualEvidenceText = '\n\nВІЗУАЛЬНІ ДОКАЗИ:\n';
    visualEvidence.forEach((evidence, idx) => {
        visualEvidenceText += `${idx + 1}. ${evidence.description} (${evidence.type}) - ${evidence.timestamp}\n`;
    });
}
```

## API Довідка

### Запуск Моніторингу
```bash
POST http://localhost:5001/api/grisha/start-monitoring
```
**Відповідь:**
```json
{
    "success": true,
    "message": "Візуальний моніторинг Гриші запущено",
    "monitoring_id": "monitor_1735..."
}
```

### Зупинка Моніторингу  
```bash
POST http://localhost:5001/api/grisha/stop-monitoring
```
**Відповідь:**
```json
{
    "success": true,
    "message": "Візуальний моніторинг Гриші зупинено",
    "evidence_count": 15
}
```

### Отримання Візуальних Доказів
```bash
GET http://localhost:5001/api/grisha/visual-evidence
```
**Відповідь:**
```json
{
    "success": true,
    "evidence": [
        {
            "timestamp": "2024-01-03T10:30:15.123456",
            "type": "terminal_activity",
            "description": "Виявлено активність в терміналі з командами створення файлів",
            "objects": ["terminal", "text_editor"]
        }
    ]
}
```

### Статус Моніторингу
```bash
GET http://localhost:5001/api/grisha/monitoring-status
```
**Відповідь:**
```json
{
    "is_monitoring": true,
    "monitoring_id": "monitor_1735...",
    "evidence_count": 8,
    "start_time": "2024-01-03T10:25:00.000000"
}
```

## Структура Візуальних Доказів

### Типи Доказів
- **`terminal_activity`** - Активність в терміналі
- **`file_creation`** - Створення файлів
- **`application_usage`** - Використання додатків
- **`desktop_activity`** - Активність на робочому столі
- **`screenshot_basic`** - Загальний скріншот

### Формат Даних
```python
evidence_item = {
    'timestamp': str,           # ISO формат дати/часу
    'type': str,                # Тип активності
    'description': str,         # Опис того, що відбувається
    'objects': List[str],       # Виявлені об'єкти
    'screenshot_path': str      # Шлях до скріншота (опціонально)
}
```

## Інтеграція в Верифікацію

### Розширений Промпт для Гриши
```python
verifyPrompt = [
    'Ти — Гриша, незалежний валідаційний агент. Твоє завдання — ПЕРЕВІРИТИ твердження Тетяни незалежно, використовуючи:',
    '1. Доступ до системи (файли/OS/додатки)',
    '2. Візуальні докази з моніторингу екрану під час виконання',
    # ...
    'Поверни РІВНО JSON з полями:',
    '{ "criteria": [...], "confidence": number, "summary": string, "visual_verification": string }',
    # ...
    visualEvidenceText,  # Вставляємо візуальні докази
]
```

### Розширений Результат Верифікації
```javascript
grishaVerdict.visual_verification = verify.result?.visual_verification;
```

## Тестування

### Запуск Тестів
```bash
python test_grisha_vision.py
```

### Очікувані Результати
- ✅ API ендпоінти доступні
- ✅ Моніторинг запускається та зупиняється  
- ✅ Візуальні докази збираються
- ✅ Гриша використовує візуальну інформацію при верифікації

## Налаштування

### Конфігурація Моніторингу
```python
# У vision_processor.py
MONITORING_INTERVAL = 2.0  # Інтервал між скріншотами (секунди)
MAX_EVIDENCE_ITEMS = 50    # Максимальна кількість доказів
SCREENSHOT_QUALITY = 80    # Якість скріншотів (1-100)
```

### Обмеження Ресурсів
- Моніторинг автоматично обмежується 50 доказами
- Скріншоти зберігаються тимчасово та очищаються після завершення
- Інтервал захоплення 2 секунди для оптимізації продуктивності

## Приклад Використання

### 1. Користувач дає завдання
```
Користувач: "Створи файл README.md з описом проекту"
```

### 2. Atlas планує, Тетяна виконує (з автоматичним моніторингом)
```
Atlas: План створення файлу...
[Автоматично запускається візуальний моніторинг]
Тетяна: Створюю файл README.md...
[Захоплюються скріншоти процесу]
[Автоматично зупиняється моніторинг]
```

### 3. Гриша верифікує з візуальними доказами
```
Гриша: 
- Перевірив наявність файлу ✅
- Візуальні докази підтверджують створення файлу в редакторі ✅
- Confidence: 0.95 ✅

Візуальна верифікація: "Під час виконання зафіксовано відкриття текстового редактора, 
створення нового файлу README.md та введення тексту. Візуальні докази повністю 
підтверджують звіт Тетяни про успішне створення файлу."
```

## Технічні Деталі

### Залежності
- `pyautogui` - Захоплення скріншотів
- `opencv-python` - Обробка зображень  
- `threading` - Фонове моніторингове завдання
- `requests` - HTTP комунікація між сервісами

### Файли
- `frontend_new/app/vision_processor.py` - Основна логіка моніторингу
- `frontend_new/app/atlas_server.py` - API ендпоінти  
- `frontend_new/orchestrator/server.js` - Інтеграція з агентами
- `test_grisha_vision.py` - Тестовий скрипт

### Метрики Продуктивності
- Час запуску моніторингу: ~100ms
- Час захоплення скріншота: ~50ms
- Час аналізу скріншота: ~200ms
- Загальний вплив на продуктивність: мінімальний

## Подальший Розвиток

### Планові Покращення
1. **Розпізнавання OCR** - Читання тексту зі скріншотів
2. **Детекція змін** - Виявлення конкретних змін між скріншотами
3. **Аналіз роботи з файлами** - Детекція файлових операцій
4. **Інтеграція з рухами миші** - Відстеження дій користувача
5. **Збереження відео** - Запис процесу виконання як відео

### Можливі Розширення
- Інтеграція з системою логування
- Експорт доказів у різні формати
- Dashboard для перегляду візуальної історії
- Налаштування типів моніторингу

---

**Примітка:** Ця система є повністю інтегрованою в ATLAS і готова до використання. Візуальний моніторинг запускається автоматично при виконанні завдань Тетяною та надає Гриші додаткові докази для більш точної верифікації.
