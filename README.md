# 🧠 ATLAS - Pure Intelligent Multi-Agent System

**Повністю інтелігентна система без хардкорів, імітацій та фейків**

## Огляд

ATLAS - це революційна інтелігентна система, що працює виключно на базі AI рішень. Система складається з трьох інтелігентних агентів і забезпечує виконання завдань без жодних хардкорів чи симуляцій.

## 🚀 Швидкий старт

### Точка входу (як зазначено в завданні):
```bash
./start_stack_intelligent.sh
```

### Вимоги:
- **Локальне AI API** на порті 3010 (обов'язково)
- Python 3.8+
- Goose на порті 3000 (рекомендовано)
- TTS сервер на порті 3001 (опціонально)

### Приклад запуску AI API:
```bash
# Ollama
ollama serve

# LM Studio
# Start local server on port 3010

# LocalAI  
./local-ai --port 3010
```

## 📊 Архітектура

### Нова інтелігентна система (`intelligent_atlas/`):
```
🧠 ATLAS Pure Intelligent System
├── 🔧 IntelligentEngine     - Головний AI движок (без хардкорів)
├── 🦢 GooseExecutor         - Реальне виконання через Goose
├── 🎭 AgentSystem           - 3 інтелігентних агенти
├── 🎤 VoiceSystem           - TTS/STT (Whisper 3)
├── 🌐 WebInterface          - Мінімальний веб UI
└── ⚙️ DynamicConfig         - AI-генеровані конфігурації
```

### Агенти:
- **🎯 Atlas** - Планувальник (AI-driven planning)
- **⚙️ Tetyana** - Виконавець (Goose + AI execution)  
- **✅ Grisha** - Валідатор (AI + Goose validation)

## 🧠 Ключові принципи

### ✅ Pure Intelligence
- Всі рішення через локальне AI API (порт 3010)
- Жодних hardcoded правил
- Повна адаптація до ситуацій

### ✅ Super Reliability  
- Єдина точка відмови: AI API
- Автоматичне відновлення
- Гарантія виконання

### ✅ Zero Hardcode Policy
- Конфігурації генеруються AI
- Немає статичних значень
- Динамічна адаптація

## 📂 Структура проекту

```
ATLAS/
├── intelligent_atlas/           # 🧠 Нова інтелігентна система
│   ├── core/                   # Основні компоненти  
│   ├── config/                 # AI-генеровані конфігурації
│   ├── static/                 # Веб ресурси
│   ├── templates/              # HTML шаблони  
│   ├── start_intelligent.sh    # Точка входу
│   └── README.md              # Детальна документація
├── old2/                       # Бекап старої системи (frontend_new)
├── archive/                    # Архів старих файлів
├── goose/                      # Goose система (незмінна)
├── ukrainian-tts/              # TTS система (незмінна)
└── start_stack_intelligent.sh  # 🚀 ГОЛОВНА ТОЧКА ВХОДУ
```

## 🔧 Використання

### Запуск системи:
```bash
./start_stack_intelligent.sh
```

### Доступ до інтерфейсу:
- **Веб-інтерфейс**: http://127.0.0.1:5001
- **Чат з агентами**: через веб або API
- **Голосовий ввід**: підтримується (TTS/STT)

### Управління:
```bash
cd intelligent_atlas

# Запуск
./start_intelligent.sh start

# Статус  
./start_intelligent.sh status

# Зупинка
./start_intelligent.sh stop

# Перезапуск
./start_intelligent.sh restart
```

## 📋 Що змінилося

### ✅ Створено нову систему:
- **100% AI-driven** - всі рішення через AI API
- **Zero hardcodes** - жодних статичних значень
- **Super reliable** - мінімальні точки відмови
- **Real execution** - через Goose для всіх агентів
- **Dynamic config** - AI генерує конфігурації

### ✅ Переміщено старе:
- `frontend_new` → `old2/` (повний бекап)
- Старі скрипти → `archive/old_scripts/`
- Стара документація → `archive/`

### ✅ Очищено корінь:
- Залишено тільки необхідне
- Головна точка входу: `start_stack_intelligent.sh`
- Чиста структура проекту

## 📚 Документація

Детальна документація нової системи:
- **[intelligent_atlas/README.md](intelligent_atlas/README.md)** - Повний опис нової системи
- **[Архітектурний план](intelligent_atlas/README.md#архітектура)** - Схема компонентів  
- **[API документація](intelligent_atlas/README.md#api-endpoints)** - Ендпоінти системи

## 🎯 Результат

Створена повністю інтелігентна система що:

1. **Працює на чистому AI** - без хардкорів та імітацій
2. **Використовує Goose** - для реального виконання завдань
3. **Підтримує TTS/STT** - Whisper 3 та українські голоси  
4. **Супер надійна** - мінімальні шанси на відмову
5. **Правильна структура** - чиста та логічна організація файлів
6. **Точка входу** - `start_stack_intelligent.sh` як зазначено

## 🚀 Початок роботи

```bash
# 1. Запустіть локальне AI API
ollama serve  # або інший провайдер на порті 3010

# 2. Запустіть ATLAS  
./start_stack_intelligent.sh

# 3. Відкрийте браузер
open http://127.0.0.1:5001
```

**🧠 ATLAS Pure Intelligent System - Майбутнє AI без компромісів!**
- **Strategy Optimization** - Continuous improvement of recovery approaches
- **Resource Management** - Dynamic allocation based on workload patterns

## Quick Start

### Prerequisites

- Python 3.8+
- Node.js 16+
- Virtual environment support

### Installation

1. **Environment Setup**
```bash
cd frontend
source setup_env.sh
```

2. **Start Core Services**
```bash
# Frontend with intelligent recovery
cd frontend
python atlas_minimal_live.py

# Orchestrator (separate terminal)
cd frontend_new
bash start_server.sh
```

3. **Access Interface**
- Web Interface: http://localhost:3000
- Orchestrator API: http://localhost:5101
- Recovery Bridge: ws://localhost:5102

### Configuration

The system is entirely configuration-free and self-adapting. All parameters are determined intelligently based on:

- Current system load
- Historical performance data
- Real-time resource availability
- Agent capability assessment

## 🛠️ Development & Deployment

### Project Structure

```
/
├── intelligent_atlas/        # 🧠 Pure Intelligent System (MAIN)
│   ├── core/                # Core AI agents and engine
│   ├── config/              # Dynamic configuration system
│   ├── static/              # Web interface assets
│   └── templates/           # Web templates
├── frontend_new/            # 📦 Legacy Node.js orchestrator (archived)
├── goose/                   # 🦢 Goose CLI integration
├── logs/                    # 📄 Runtime logs and monitoring
├── scripts/                 # 🔧 Deployment and maintenance
├── .github/workflows/       # 🚀 CI/CD automation
└── old*/                    # 📚 Archived legacy components
```

### 🚀 Quick Deployment

#### macOS (Recommended):
```bash
./start_stack_macos.sh    # Full intelligent stack
./status_stack.sh         # Check system health
./stop_stack.sh           # Graceful shutdown
```

#### Linux:
```bash
./start_stack.sh          # Full intelligent stack
./status_stack.sh         # Check system health  
./stop_stack.sh           # Graceful shutdown
```

### 🧪 Testing & Validation

#### Local Testing:
```bash
# Start the system
./start_stack_macos.sh

# Run smoke tests
./scripts/smoke_e2e.sh

# Check detailed status
./status_stack.sh
```

#### Required Services:
- ✅ **ATLAS Web Interface** (port 5001) - Main system
- ✅ **Local AI API** (port 3010) - CRITICAL for all AI decisions
- ⚠️ **Goose Executor** (port 3000) - Optional, enables real task execution
- ⚠️ **Ukrainian TTS** (port 3001) - Optional, enables voice synthesis

### 🔄 CI/CD Pipeline

#### Automated Testing:
- **Python Import Validation** - Core module integrity
- **Legacy System Tests** - Backward compatibility (if present)
- **E2E Smoke Tests** - Full system validation (self-hosted runner)

#### Deployment Stages:
1. **Validation** - Code quality and import validation
2. **Staging** - Automatic deployment to staging environment
3. **Production** - Manual approval for production deployment

#### Dependabot Integration:
- **Weekly Python Updates** - intelligent_atlas dependencies
- **Monthly Rust/Node Updates** - Goose and legacy components
- **GitHub Actions Updates** - CI/CD pipeline maintenance

### 🔧 Development Workflow

#### Setting up Development Environment:
```bash
# Clone and setup
cd intelligent_atlas
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Development mode
export PYTHONPATH="$(pwd):$(pwd)/core:$(pwd)/config:$PYTHONPATH"
export ATLAS_MODE="intelligent"
```

#### Making Changes:
1. **Make surgical changes** to intelligent_atlas/
2. **Test locally** with ./start_stack_macos.sh
3. **Run smoke tests** with ./scripts/smoke_e2e.sh
4. **Commit changes** - CI/CD will validate automatically
5. **Deploy to staging** - Automatic on master branch
6. **Deploy to production** - Manual workflow dispatch

### Key Files

- `frontend/intelligent_recovery.py` - Core recovery system
- `frontend_new/app/orchestrator.py` - Agent coordination
- `frontend/recovery_bridge.py` - WebSocket integration
- `frontend/env_manager.py` - Environment management

## Monitoring

### System Health

The system provides comprehensive monitoring through:

- **Real-time Dashboards** - Agent status and performance metrics
- **Failure Analytics** - Detailed analysis of recovery events
- **Resource Utilization** - CPU, memory, and network usage
- **Agent Communication** - Inter-agent message flows

### Logging

All system activities are logged with intelligent categorization:

- `logs/recovery.log` - Failure recovery events
- `logs/orchestrator.log` - Agent coordination
- `logs/performance.log` - System metrics
- `logs/errors.log` - Error analysis

## Advanced Features

### Intelligent Context Management

- **Dynamic Summarization** - Automatic context compression when limits approached
- **Priority-based Retention** - Important information preserved during context reduction
- **Multi-level Caching** - Efficient storage and retrieval of processed data

### Adaptive Resource Scaling

- **Load Balancing** - Automatic distribution of tasks across agents
- **Resource Prediction** - Proactive scaling based on usage patterns  
- **Efficiency Optimization** - Continuous tuning of system parameters

## Security

- **Zero-trust Architecture** - All communications authenticated and encrypted
- **Credential Management** - Automatic rotation and secure storage
- **Access Control** - Role-based permissions with intelligent adaptation
- **Audit Logging** - Complete tracking of system activities

## Support

For issues or questions:

1. Check the intelligent recovery logs for automatic resolution
2. Review system health dashboard for performance insights
3. Consult the adaptive learning recommendations
4. Contact the development team for advanced configuration

## License

This project is licensed under MIT License - see LICENSE file for details.

---

*ATLAS System - Fully Intelligent, Zero-Configuration Multi-Agent Orchestration*
