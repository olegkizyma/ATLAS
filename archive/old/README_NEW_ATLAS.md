# ATLAS - 3-Agent System Implementation

## Overview

ATLAS has been completely reimplemented according to the Technical Specification v1.0, featuring a robust 3-agent architecture with prompt-driven logic and enhanced safety mechanisms.

## Agent Architecture

### 👤 Atlas Agent (Curator/Strategist)
- **Role**: "Brain" of operations
- **Function**: Analyzes tasks, creates detailed plans, provides guidance
- **Capabilities**: Strategic planning, task decomposition, corrective planning

### 👩‍💻 Tetiana Agent (Goose Executor) 
- **Role**: "Hands" of operations
- **Function**: Executes technical tasks, reports progress
- **Integration**: Designed for Goose desktop system

### 👮‍♂️ Grisha Agent (Controller/Validator)
- **Role**: "Security and quality control" 
- **Function**: Plan approval, execution verification, safety oversight
- **Authority**: Senior agent with veto power over system operations

## Core Features

### ✅ Prompt-Driven Logic
- All agent behavior driven by dynamically generated prompts
- No hardcoded rules, keywords, or static scenarios
- Context-aware prompt generation based on task complexity and urgency

### ✅ 7-Step Workflow Cycle
1. **Task Assignment** - User submits task to Atlas
2. **Planning** - Atlas creates detailed execution plan
3. **Approval** - Grisha reviews and approves/rejects plan
4. **Execution** - Tetiana executes approved steps
5. **Progress** - Continuous reporting and guidance
6. **Verification** - Grisha verifies execution results
7. **Completion** - Success or corrective action

### ✅ Session Mode
- Activated during critical failures
- Breaks complex tasks into micro-steps
- Requires confirmation after each step
- Enhanced monitoring and control

### ✅ Veto System
- Grisha can halt operations for safety concerns
- 10-second system pause + user notification
- Requires user intervention to resolve

### ✅ Failure Recovery
- Automatic corrective plan generation
- Multi-level retry strategies
- Intelligent failure analysis

## Quick Start

### Installation
```bash
# Install dependencies
pip3 install flask requests

# Make scripts executable
chmod +x start_atlas.sh stop_atlas.sh status_atlas.sh demo_atlas.sh
```

### Basic Usage
```bash
# Start the system
./start_atlas.sh

# Check status
./status_atlas.sh

# Run demo
./demo_atlas.sh

# Stop the system
./stop_atlas.sh
```

### Web Interface
- **Main Interface**: http://localhost:5001
- **API Health**: http://localhost:5001/api/health
- **System Status**: http://localhost:5001/api/system/status

## API Reference

### Task Management
```bash
# Create task
curl -X POST -H "Content-Type: application/json" \
  -d '{"description":"Your task here","user_id":"user"}' \
  http://localhost:5001/api/tasks

# Get task status
curl http://localhost:5001/api/tasks/<task_id>

# List all tasks
curl http://localhost:5001/api/tasks
```

### System Control
```bash
# System status
curl http://localhost:5001/api/system/status

# Health check
curl http://localhost:5001/api/health

# Resolve veto (if needed)
curl -X POST -H "Content-Type: application/json" \
  -d '{"user_id":"user","command":"continue"}' \
  http://localhost:5001/api/veto/resolve
```

## File Structure

```
/
├── atlas_backend.py          # Core 3-agent system
├── atlas_web_server.py       # Flask web server
├── atlas_prompts.py          # Dynamic prompt generation
├── ATLAS_SYSTEM_DOCS.py      # Complete documentation
├── start_atlas.sh           # System startup
├── stop_atlas.sh            # System shutdown
├── status_atlas.sh          # Status check
├── demo_atlas.sh            # Full demo
├── requirements.txt          # Dependencies
├── MIGRATION_PLAN.md         # Migration documentation
├── frontend_new/            # Preserved web interface
│   └── app/
│       ├── templates/       # HTML templates
│       └── static/         # CSS, JS, assets  
└── old/                     # Archived legacy code
    ├── atlas_server.py      # Old Flask server
    ├── orchestrator/        # Old Node.js system
    ├── config/             # Old configuration
    └── ...                 # Other legacy components
```

## Migration from Legacy System

The legacy ATLAS system has been completely reimplemented:

### ✅ **Preserved**
- Web interface design (templates, CSS, 3D models)
- Core concept of multi-agent coordination
- Port 5001 for web server

### ✅ **Improved**  
- Clean 3-agent architecture (Atlas/Tetiana/Grisha)
- Prompt-driven logic instead of hardcoded rules
- Enhanced safety with veto system
- Session mode for critical situations
- Simplified deployment and management
- Better error handling and recovery

### ✅ **Archived**
- Legacy Python/Node.js hybrid system → `old/`
- Complex orchestrator logic → `old/orchestrator/`
- Old configuration system → `old/config/`

## Technical Implementation

### Dynamic Prompt System
```python
# Example usage
from atlas_prompts import get_agent_prompt

context = {
    "task_description": "Find popular videos",
    "complexity": "moderate", 
    "urgency": "standard"
}

prompt = get_agent_prompt("atlas", "task_planning", context)
```

### Agent Communication
- Asynchronous message passing
- Event-driven architecture
- Real-time status updates
- Queue-based task management

### Safety Mechanisms
- Grisha's veto power for critical situations
- Session mode for enhanced control
- Comprehensive error handling
- User override capabilities

## Development Notes

This implementation fully satisfies the Technical Specification requirements:

1. **✅ 3-Agent Architecture** - Atlas, Tetiana, Grisha with clear roles
2. **✅ Prompt-Driven Logic** - No hardcoded rules or static scenarios  
3. **✅ Living System** - Human-like agent communication
4. **✅ Uncompromising Execution** - Session mode and failure recovery
5. **✅ Hierarchy & Security** - Grisha's veto authority
6. **✅ Web Interface Preservation** - Existing design maintained
7. **✅ Legacy Code Archival** - All old code moved to `old/`

The system is ready for production use and future Goose integration.

## Support

- **Logs**: `tail -f logs/atlas_system.log`
- **Status**: `./status_atlas.sh` 
- **Demo**: `./demo_atlas.sh`
- **Health**: `curl http://localhost:5001/api/health`

---

*ATLAS 3-Agent System - Implementation Complete* 🚀