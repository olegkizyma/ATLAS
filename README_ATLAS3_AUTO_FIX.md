# ATLAS3 Auto-Fix CI/CD System

Автоматизована система CI/CD з виправленням коду для проекту ATLAS3, що забезпечує безперервну інтеграцію з автоматичним виявленням та усуненням помилок.

## 🎯 Основна мета

Налаштування GitHub Actions для автоматичного запуску тестів при кожному коміті в гілку `ATLAS3`, з можливістю автоматичного виправлення помилок та повторного запуску тестів до повного успіху.

## 🏗️ Архітектура системи

### Компоненти

1. **GitHub Actions Workflow** (`.github/workflows/atlas3-auto-fix.yml`)
   - Основний workflow для автоматизації CI/CD
   - Підтримка Mac Studio M1 Max та Ubuntu runners
   - Ітеративний цикл тест-виправлення-коміт

2. **Auto-Fix Script** (`.github/scripts/auto-fix.sh`)
   - Інтелектуальний скрипт для автоматичного виправлення коду
   - Аналіз логів помилок та застосування цільових виправлень
   - Валідація виправлень перед комітом

3. **Enhanced Smoke Test** (`scripts/smoke_test_enhanced.sh`)
   - Покращений smoke test з можливістю запуску mock сервісів
   - Перевірка структури репозиторію та синтаксису коду
   - Відмовостійкість при недоступності основних сервісів

4. **Configuration** (`.github/config/atlas3-config.yml`)
   - Централізована конфігурація для CI/CD
   - Налаштування для різних платформ та середовищ

## 🚀 Функціональність

### Автоматичний цикл виправлення

1. **Запуск тестів** - виконання smoke та e2e тестів
2. **Виявлення помилок** - аналіз логів та ідентифікація проблем
3. **Застосування виправлень** - автоматичне виправлення коду
4. **Коміт змін** - автоматичний коміт виправлень в гілку ATLAS3
5. **Повторний запуск** - перезапуск тестів з новими виправленнями
6. **Ітерація** - повторення до успішного проходження всіх тестів

### Підтримувані платформи

- **Mac Studio M1 Max** (self-hosted runner)
- **Ubuntu Latest** (GitHub-hosted runner)

### Типи тестів

- **Smoke Tests** - базові тести функціональності
- **E2E Tests** - комплексні тести всієї системи
- **Health Checks** - перевірка стану сервісів
- **Structure Tests** - валідація структури репозиторію

## 📋 Налаштування

### Попередні вимоги

1. **Self-hosted runner для Mac Studio M1 Max**:
   ```bash
   # Встановлення GitHub Actions Runner
   mkdir actions-runner && cd actions-runner
   curl -o actions-runner-osx-arm64-2.311.0.tar.gz -L https://github.com/actions/runner/releases/download/v2.311.0/actions-runner-osx-arm64-2.311.0.tar.gz
   tar xzf ./actions-runner-osx-arm64-2.311.0.tar.gz
   ./config.sh --url https://github.com/olegkizyma/ATLAS --token YOUR_TOKEN --labels mac-studio-m1-max
   ```

2. **Встановлення залежностей на runner**:
   ```bash
   # Python 3.11+
   brew install python@3.11
   
   # Node.js 20+
   brew install node@20
   
   # Додаткові інструменти
   brew install curl git
   ```

### Конфігурація репозиторію

1. **Створіння гілки ATLAS3**:
   ```bash
   git checkout -b ATLAS3
   git push origin ATLAS3
   ```

2. **Налаштування GitHub Secrets** (за потреби):
   - `ANALYTICS_ENDPOINT` - ендпоінт для аналітики
   - `METRICS_ENDPOINT` - ендпоінт для метрик

3. **Налаштування Permissions**:
   - Workflow має права на запис в репозиторій
   - Actions можуть створювати коміти

## 🔧 Використання

### Автоматичний запуск

Workflow запускається автоматично при:
- Push в гілку `ATLAS3`
- Pull Request до гілки `ATLAS3`

### Ручний запуск

```bash
# Через GitHub UI (Actions -> ATLAS3 Auto-Fix CI/CD -> Run workflow)
# Або через CLI
gh workflow run "ATLAS3 Auto-Fix CI/CD" --ref ATLAS3
```

### Параметри запуску

- `max_iterations` - максимальна кількість ітерацій auto-fix (за замовчуванням: 5)

## 📊 Моніторинг та аналітика

### Метрики продуктивності

- CPU usage
- Memory usage  
- Disk usage
- Workflow execution time

### Звіти

- **Test Reports** - детальні звіти про проходження тестів
- **Fix Reports** - звіти про застосовані виправлення
- **Performance Metrics** - метрики продуктивності системи

### Артефакти

Всі логи та звіти зберігаються як GitHub Artifacts:
- `atlas3-auto-fix-logs-{platform}-{run_number}`
- `performance-metrics-{run_number}`

## 🛠️ Типи автоматичних виправлень

### Загальні виправлення

1. **Структурні**:
   - Створення відсутніх тестових файлів
   - Додавання скриптів в package.json
   - Встановлення executable permissions

2. **Залежності**:
   - Створення мінімального requirements.txt для CI
   - Виправлення конфліктів залежностей

3. **Конфігурація**:
   - Оновлення налаштувань для CI середовища
   - Додавання health check endpoints

### Цільові виправлення

- **Health endpoint issues** - створення mock health endpoints
- **Service connectivity** - налаштування fallback механізмів
- **Syntax errors** - автоматичне виправлення синтаксичних помилок

## 🚨 Обробка помилок

### Стратегії відновлення

1. **Service fallback** - використання mock сервісів при недоступності основних
2. **Graceful degradation** - часткове виконання тестів при проблемах
3. **Retry mechanism** - повторні спроби з експоненційною затримкою

### Логування

Всі дії логуються в детальних логах:
- `logs/auto_fix_{iteration}.log` - логи auto-fix
- `logs/smoke_test_{iteration}.log` - логи smoke тестів
- `logs/e2e_test_{iteration}.log` - логи e2e тестів

## 🔍 Troubleshooting

### Загальні проблеми

1. **Runner недоступний**:
   - Перевірити статус self-hosted runner
   - Переконатися, що всі залежності встановлені

2. **Auto-fix не спрацьовує**:
   - Перевірити логи в GitHub Actions
   - Переконатися, що auto-fix script має executable permissions

3. **Тести постійно падають**:
   - Збільшити `max_iterations`
   - Перевірити специфічні помилки в логах

### Команди для діагностики

```bash
# Локальне тестування auto-fix
bash .github/scripts/auto-fix.sh 1

# Локальне тестування enhanced smoke test
bash scripts/smoke_test_enhanced.sh

# Перевірка структури репозиторію
bash scripts/health_check.sh
```

## 📝 Розвиток

### Додавання нових auto-fix правил

1. Відредагувати `.github/scripts/auto-fix.sh`
2. Додати нову функцію виправлення
3. Протестувати локально
4. Створити PR з описом змін

### Додавання нових тестів

1. Створити новий тестовий скрипт в `scripts/`
2. Інтегрувати в `smoke_test_enhanced.sh`
3. Оновити workflow за потреби

## 📞 Підтримка

При виникненні проблем:

1. Перевірити [GitHub Actions logs](https://github.com/olegkizyma/ATLAS/actions)
2. Переглянути issue tracker
3. Створити новий issue з детальним описом проблеми

---

## 🎉 Результат

Система ATLAS3 Auto-Fix CI/CD забезпечує:

- ✅ Автоматичне виявлення та виправлення помилок
- ✅ Безперервну інтеграцію з мінімальним втручанням
- ✅ Детальний моніторинг та звітність
- ✅ Підтримку Mac Studio M1 Max та інших платформ
- ✅ Масштабованість та розширюваність

**Ваш код тепер автоматично стає кращим з кожним комітом! 🚀**