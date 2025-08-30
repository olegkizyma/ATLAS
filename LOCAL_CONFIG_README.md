# Перехід на локальний конфіг Goose

## ✅ Виконано

### 1. Створено локальну конфігурацію
- `goose/config.yaml` - основний локальний конфіг
- `goose/goose/config.yaml` - для XDG_CONFIG_HOME
- `goose/config.toml` - резерв (якщо стане потрібен)

### 2. Деактивовано глобальну конфігурацію  
- `~/.config/goose/config.yaml` → `~/.config/goose/config.yaml.disabled`
- Створено резервну копію: `config.yaml.backup-global`

### 3. Оновлено скрипти запуску
- `start_atlas_optimized.sh` - використовує `export XDG_CONFIG_HOME`
- `start_atlas_fast.sh` - використовує `export XDG_CONFIG_HOME`
- `goose/start_ukraine_tts.sh` - використовує `export XDG_CONFIG_HOME`

### 4. Створено інструменти
- `test_local_config.sh` - скрипт для тестування конфігу

## 🚀 Як використовувати

### Автоматичний запуск
```bash
# Використовують локальний конфіг автоматично
./start_atlas_optimized.sh
./start_atlas_fast.sh
```

### Ручний запуск
```bash
cd /Users/dev/Documents/GitHub/ATLAS/goose
export XDG_CONFIG_HOME="$(pwd)"
source bin/activate-hermit
./target/release/goosed agent
```

## 🔧 Налаштування

### Редагування локального конфігу
```bash
code /Users/dev/Documents/GitHub/ATLAS/goose/goose/config.yaml
```

### Повернення до глобального конфігу (за потреби)
```bash
mv ~/.config/goose/config.yaml.disabled ~/.config/goose/config.yaml
```

### Перевірка поточного конфігу
```bash
./test_local_config.sh
```

## 📂 Структура конфігів

```
/Users/dev/Documents/GitHub/ATLAS/goose/
├── config.yaml                 # Основний локальний конфіг
├── goose/
│   └── config.yaml             # Для XDG_CONFIG_HOME
├── config.toml                 # Резервний TOML (якщо потрібен)
└── test_local_config.sh        # Скрипт тестування

~/.config/goose/
├── config.yaml.disabled        # Деактивований глобальний
└── config.yaml.backup-global   # Резервна копія
```

## ✅ Переваги локального конфігу

- ✅ Ізоляція від глобальних налаштувань
- ✅ Версіонування разом з проектом
- ✅ Консистентність між розробниками
- ✅ Простіше налаштування CI/CD
