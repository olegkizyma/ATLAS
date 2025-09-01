# ATLAS System Startup Guide

## Overview
ATLAS is a multi-agent intelligent system with a refactored frontend_new architecture designed for stability and modularity.

## Quick Start

### For macOS Users (Recommended)
```bash
./start_stack_macos.sh
```
This script:
- ✅ Works without Rust/Cargo dependencies
- ✅ Automatically sets up Python virtual environment
- ✅ Installs Node.js dependencies
- ✅ Starts all essential services
- ✅ Provides clear status feedback

### For Linux Users (Full Stack)
```bash
./start_stack.sh
```
This script attempts to build Goose (requires Rust), but falls back gracefully if not available.

### Frontend Only (Testing)
```bash
./start_frontend_only.sh
```
Starts only the Python frontend and Node.js orchestrator.

## Services

### Core Services
- **Python Frontend**: http://localhost:5001 - Main web interface
- **Node.js Orchestrator**: http://localhost:5101 - API orchestration
- **Recovery Bridge**: ws://localhost:5102 - WebSocket recovery system

### Optional Services
- **Goose Web Interface**: http://localhost:3000 - Requires Rust compilation

## Web Interface Features
- 🎨 **Hacker-style terminal interface** with green monospace logs
- 💬 **Functional chat system** with streaming responses
- 📊 **Real-time log streaming** without interface blocking
- 🔧 **Modular architecture** preventing system lockups

## Management

### Stop Services
```bash
./stop_stack.sh
```

### View Logs
```bash
tail -f logs/*.log
```

### Check Status
```bash
./status_stack.sh
```

## Architecture Highlights

### Fixed Issues
1. **Removed duplicates**: Eliminated unused `context_summarizer.py`
2. **Fixed JavaScript interconnections**: Converted ES6 exports to global variables
3. **Fixed bash syntax**: Corrected setup_env.sh script errors
4. **Made system macOS compatible**: Goose dependency is now optional
5. **Improved error handling**: Better port checking and service management

### File Structure
```
frontend_new/
├── app/
│   ├── static/js/ - Modular JavaScript managers
│   ├── templates/ - Clean HTML templates  
│   ├── api/ - REST API endpoints
│   └── atlas_server.py - Main Flask server
├── orchestrator/
│   ├── server.js - Node.js orchestration
│   └── context_summarizer.js - Smart context management
├── config/ - Configuration and recovery systems
└── requirements.txt - Python dependencies
```

### Key Features
- **No interface blocking**: Chat input never locks up
- **No automatic reloads**: Stable interface without refreshing
- **Modular design**: Separate managers for different functions
- **Service Worker caching**: Optimized performance
- **Smart error recovery**: Automatic fallbacks and retries

## Troubleshooting

### Port Conflicts
If ports are busy, use:
```bash
lsof -ti:5001 | xargs kill  # Kill frontend
lsof -ti:5101 | xargs kill  # Kill orchestrator
```

### Python Environment Issues
```bash
cd frontend_new
rm -rf venv
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Node.js Dependencies
```bash
cd frontend_new/orchestrator
rm -rf node_modules
npm install
```

## Development

### Testing Changes
1. Stop services: `./stop_stack.sh`
2. Make changes
3. Start services: `./start_stack_macos.sh`
4. Check logs: `tail -f logs/*.log`

### Adding Features
- **JavaScript**: Add new managers to `app/static/js/`
- **Python**: Extend `app/atlas_server.py` or add new modules
- **Node.js**: Modify `orchestrator/server.js`

## Success Indicators
✅ All services show "running and responsive"  
✅ Web interface loads at http://localhost:5001  
✅ Green terminal-style logs appear  
✅ Chat button is functional  
✅ No JavaScript errors in browser console