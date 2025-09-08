# ATLAS - Intelligent Multi-Agent System

ATLAS is a comprehensive Ukrainian AI system featuring multi-agent orchestration, text-to-speech synthesis, and intelligent recovery capabilities.

## Quick Start

```bash
# Start/Restart complete system
./restart_simple.sh

# Check system status  
./status_stack.sh

# Monitor logs with highlighting
./logs.sh

# Stop system
./stop_stack.sh
```

## Services

- **Frontend** (port 5001): Main web interface
- **Orchestrator** (port 5101): Agent coordination API  
- **TTS Server** (port 3001): Ukrainian text-to-speech
- **Goose Web** (port 3000): AI assistant interface
- **Recovery Bridge** (port 5102): System recovery WebSocket

## Logging System

ATLAS includes a comprehensive logging system with:
- 🎨 Color-coded error highlighting
- 📊 Real-time log monitoring  
- 🔍 Interactive log search
- 📦 Automatic log archiving
- 📡 Centralized log collection

```bash
# Interactive logging menu
./logs.sh

# Watch all logs with highlighting  
./logs.sh --all

# Monitor errors only
./logs.sh --errors

# Start centralized logging
./logs.sh -c start
```

## System Requirements

- Python 3.8+ with virtual environment
- Node.js 18+
- macOS/Linux

All services start automatically with `./restart_simple.sh`.
