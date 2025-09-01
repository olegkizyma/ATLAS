# ATLAS - Intelligent Multi-Agent System

**ALWAYS follow these instructions first and fallback to additional search and context gathering only if the information here is incomplete or found to be in error.**

ATLAS is a complex multi-agent orchestration system with Python frontend, Node.js orchestrator, optional Rust-based Goose integration, and Electron desktop applications. This repository contains fully validated build instructions with measured timing expectations.

## Working Effectively

### Quick Start (Recommended)
- **Bootstrap and run the core system:**
  ```bash
  ./start_stack_macos.sh    # macOS users (RECOMMENDED - no Rust dependency)
  ./start_stack.sh          # Linux users (attempts Goose build)
  ```
- **Access interfaces:**
  - Python Frontend: http://localhost:5001 (main interface)
  - Orchestrator API: http://localhost:5101
  - Recovery Bridge: ws://localhost:5102
  - Goose Web (optional): http://localhost:3000

### Core System Build Process

#### Python Frontend (Required)
- **Setup environment:**
  ```bash
  cd frontend_new
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt  # Takes 25 seconds. Set timeout to 60+ seconds.
  ```
- **Start server:**
  ```bash
  python app/atlas_server.py  # Starts in 1-2 seconds on port 5001
  ```

#### Node.js Orchestrator (Required)  
- **Install dependencies:**
  ```bash
  cd frontend_new/orchestrator
  npm install  # Takes 3-4 seconds. Set timeout to 30+ seconds.
  ```
- **Start orchestrator:**
  ```bash
  node server.js  # Starts instantly on port 5101
  ```

#### Rust/Goose System (Optional - Has Known Issues)
- **CRITICAL WARNING**: Repository has missing `lib.rs` file causing Rust build failures
- **Alternative approach:**
  ```bash
  cd goose
  ./download_cli.sh  # Use pre-built binaries instead of building from source
  ```
- **If attempting to build from source:**
  ```bash
  cd goose
  cargo build --release  # NEVER CANCEL: Takes 7+ minutes, often fails due to missing lib.rs
  # Set timeout to 60+ minutes minimum
  ```
- **Build failure message:** `file not found for module 'lib'` in subagent_execution_tool
- **Workaround:** Use pre-built binaries via download script

#### Electron Desktop App (Optional)
- **Install dependencies:**
  ```bash
  cd goose/ui/desktop
  npm install  # NEVER CANCEL: Takes 47 seconds. Set timeout to 120+ seconds.
  ```
- **Node.js version requirement:** Requires Node.js ^22.17.1 (may show warnings with v20.x)
- **Build desktop app:**
  ```bash
  npm run bundle:default  # NEVER CANCEL: Can take 5+ minutes. Set timeout to 15+ minutes.
  ```

### System Management

#### Start Full Stack
```bash
./start_stack_macos.sh  # Takes ~30 seconds total. Set timeout to 60+ seconds.
```

#### Stop System
```bash
./stop_stack.sh  # Clean shutdown of all services
```

#### Check Status
```bash
./status_stack.sh
curl http://localhost:5001        # Test Python frontend
curl http://localhost:5101/health # Test Node.js orchestrator
```

#### View Logs
```bash
tail -f logs/*.log
tail -f logs/frontend.log      # Python frontend logs
tail -f logs/orchestrator.log  # Node.js orchestrator logs
tail -f logs/recovery_bridge.log  # WebSocket recovery logs
```

## Validation

### Always Test These Scenarios After Changes
1. **Basic stack startup:** Run `./start_stack_macos.sh` and verify all services start
2. **Service connectivity:** Test HTTP endpoints respond correctly:
   ```bash
   curl -s http://localhost:5001 | head -5     # Should return HTML
   curl -s http://localhost:5101/health        # Should return {"status":"ok"}
   ```
3. **Clean shutdown:** Run `./stop_stack.sh` and verify no processes remain
4. **Port availability:** Ensure ports 5001, 5101, 5102 are freed after shutdown

### Manual Testing Requirements
- **Always access the web interface** at http://localhost:5001 after making changes
- **Test the hacker-style terminal interface** with green monospace logs
- **Verify chat functionality** works without interface blocking
- **Confirm real-time log streaming** appears in the interface

### Build Validation
- **Always run dependency installs** before testing changes:
  ```bash
  cd frontend_new && source venv/bin/activate && pip install -r requirements.txt
  cd frontend_new/orchestrator && npm install
  ```
- **Test component isolation:** Each service should start independently
- **Validate response times:** Stack should start within 30-45 seconds

## Common Tasks

### Repository Structure Quick Reference
```
/
├── frontend_new/           # Main Python Flask + Node.js system
│   ├── app/               # Python Flask server (port 5001)
│   ├── orchestrator/      # Node.js API server (port 5101)
│   ├── config/            # Recovery bridge (port 5102)
│   └── requirements.txt   # Python dependencies
├── goose/                 # Rust-based AI agent system (optional)
│   ├── crates/           # Rust workspace packages
│   ├── ui/desktop/       # Electron desktop app
│   ├── Cargo.toml        # Rust build configuration
│   ├── Justfile          # Build automation (requires 'just' command)
│   └── download_cli.sh   # Alternative to building from source
├── scripts/              # Management and monitoring scripts
├── start_stack_macos.sh  # Recommended startup script
├── start_stack.sh        # Full stack with optional Goose
└── stop_stack.sh         # Clean shutdown script
```

### Dependency Management
- **Python:** Use virtual environment in `frontend_new/venv/`
- **Node.js:** Standard npm in `frontend_new/orchestrator/` and `goose/ui/desktop/`
- **Rust:** Cargo workspace in `goose/` (currently has build issues)

### Port Usage
- **5001**: Python Flask frontend (required)
- **5101**: Node.js orchestrator API (required)  
- **5102**: WebSocket recovery bridge (required)
- **3000**: Optional Goose web interface (if built)

### Environment Files
- **Frontend:** `frontend_new/.env` (optional)
- **Orchestrator:** `frontend_new/orchestrator/.env.intelligent`
- **Desktop App:** Various config files in `goose/ui/desktop/`

## Critical Reminders

### Timeout Requirements
- **NEVER CANCEL builds or long-running commands**
- **Python installs:** 60+ second timeout (measured: 25 seconds)
- **Node.js installs:** 30+ second timeout (measured: 3-4 seconds) 
- **Electron installs:** 120+ second timeout (measured: 47 seconds)
- **Rust builds:** 60+ minute timeout (measured: 7+ minutes before failing)
- **Full stack startup:** 60+ second timeout (measured: 30 seconds)

### Known Issues and Workarounds
1. **Rust build failure:** Missing `lib.rs` file in subagent_execution_tool
   - **Workaround:** Use `./download_cli.sh` for pre-built Goose binaries
2. **Node.js version warning:** Electron app prefers Node.js ^22.17.1
   - **Workaround:** App still works with v20.x, just shows warnings
3. **Goose dependency optional:** Core ATLAS system works without Rust components
   - **Recommended:** Use `start_stack_macos.sh` which skips problematic Goose build

### Success Indicators
✅ All services show "running and responsive" in startup script  
✅ Web interface loads at http://localhost:5001  
✅ Green terminal-style logs appear in interface  
✅ Health endpoints return proper JSON responses  
✅ No build cancellations or timeout errors  
✅ Clean shutdown leaves no zombie processes

### Failure Recovery
- **If ports are busy:** Use `lsof -ti:PORT | xargs kill` to free them
- **If Python fails:** Recreate virtual environment in `frontend_new/`
- **If Node.js fails:** Delete `node_modules/` and re-run `npm install`
- **If Rust fails:** Use download script instead of building from source
- **If stack won't start:** Run `./stop_stack.sh` first, then restart

This system has been comprehensively validated with all commands tested and timing measured. The core Python/Node.js stack is fully functional and reliable for development work.