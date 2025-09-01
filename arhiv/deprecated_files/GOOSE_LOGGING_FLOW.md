# 🦆 ПОТІК ЛОГУВАННЯ В GOOSE

## 📍 Розташування логів
```
Unix/macOS:
~/.local/state/goose/logs/server/YYYY-MM-DD/YYYYMMDD_HHMMSS-goosed.log

Windows:
%APPDATA%\Block\goose\data\logs\server\YYYY-MM-DD\YYYYMMDD_HHMMSS-goosed.log
```

## 🔄 ПОТІК ЛОГУВАННЯ - ДВА НАПРЯМКИ

### 1. 📁 ФАЙЛОВИЙ ПОТІК (JSON формат)
**Куди:** `~/.local/state/goose/logs/server/2025-08-27/20250827_HHMMSS-goosed.log`
**Рівень:** DEBUG і вище
**Формат:** JSON з детальною інформацією
**Налаштування:** `file_layer` в `logging.rs:54-61`

```rust
let file_layer = fmt::layer()
    .with_target(true)      // показує модуль
    .with_level(true)       // показує рівень
    .with_writer(file_appender)
    .with_ansi(false)       // без кольорів
    .with_file(true);       // з ім'ям файлу
```

### 2. 🖥️ КОНСОЛЬНИЙ ПОТІК (STDERR)
**Куди:** `std::io::stderr` - стандартний потік помилок
**Рівень:** INFO і вище
**Формат:** Pretty-printed з кольорами
**Налаштування:** `logging.rs:68-75`

```rust
let console_layer = fmt::layer()
    .with_writer(std::io::stderr)  // ← ТУТ ВІДПОВІДЬ!
    .with_target(true)
    .with_level(true)
    .with_ansi(true)         // кольори в терміналі
    .with_file(true)
    .with_line_number(true)
    .pretty();               // красивий формат
```

## 🎯 РІВНІ ЛОГУВАННЯ ПО МОДУЛЯХ

```rust
EnvFilter::new("")
    .add_directive("mcp_server=debug".parse().unwrap())
    .add_directive("mcp_client=debug".parse().unwrap())
    .add_directive("goose=debug".parse().unwrap())
    .add_directive("goose_server=info".parse().unwrap())
    .add_directive("tower_http=info".parse().unwrap())
    .add_directive(LevelFilter::WARN.into())  // все інше
```

## 🔧 КАК ПЕРЕНАПРАВИТИ ПОТІК

### Стандартне використання (stderr):
```bash
./target/release/goosed agent
```

### Перенаправлення в файл:
```bash
./target/release/goosed agent 2> my_logs.txt
```

### Об'єднання stdout + stderr:
```bash
./target/release/goosed agent 2>&1 | tee combined.log
```

### Тільки в файл (без консолі):
```bash
./target/release/goosed agent 2> logs.txt 1> /dev/null
```

## 📊 ЩО ЛОГУЄТЬСЯ

### В консолі (stderr):
- ✅ INFO рівень і вище
- ✅ Ініціалізація сервера
- ✅ HTTP запити (tower_http)
- ✅ Статуси та помилки

### В файлах:
- ✅ DEBUG рівень і вище
- ✅ MCP комунікація
- ✅ Повна трасування запитів
- ✅ JSON структуровані дані

## 🎨 ПРИКЛАД ВИВОДУ В КОНСОЛІ

```
  2025-08-27T18:01:32.370220Z  INFO goosed::commands::agent: Initializing pricing cache...
    at crates/goose-server/src/commands/agent.rs:22

  2025-08-27T18:01:32.370728Z  INFO goose::scheduler_factory: No scheduler type specified
    at crates/goose/src/scheduler_factory.rs:43
```

## 🔄 ВИСНОВОК

**ПОТІК ЛОГУВАННЯ GOOSE ІДЕ В `stderr` (стандартний потік помилок)**

Це означає, що всі логи INFO+ рівня виводяться в термінал через stderr, 
а детальні DEBUG логи пишуться в файли для аналізу.
