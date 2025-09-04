#!/usr/bin/env python3
"""
ATLAS System Documentation - New Implementation

## Architecture Overview

The new ATLAS system implements a 3-agent architecture as specified in the technical requirements:

### Agents

1. **Atlas Agent (Curator/Strategist)**
   - Role: "Brain" of operations
   - Responsibilities: Task analysis, planning, coordination, guidance
   - Prompts: Dynamic planning and revision prompts

2. **Tetiana Agent (Goose Executor)**  
   - Role: "Hands" of operations
   - Responsibilities: Task execution, progress reporting, asking questions
   - Integration: Designed for Goose desktop system

3. **Grisha Agent (Controller/Validator)**
   - Role: "Security and quality control"
   - Responsibilities: Plan approval, verification, veto power
   - Authority: Senior agent with veto override capabilities

### Core Features

#### Prompt-Driven Logic
- All agent behavior driven by dynamically generated prompts
- No hardcoded rules, keywords, or static scenarios
- Context-aware prompt generation based on task complexity, urgency, etc.

#### 7-Step Workflow Cycle
1. Task assignment from user
2. Atlas creates detailed plan
3. Grisha approves/rejects plan
4. Tetiana executes approved steps
5. Progress reporting and questions
6. Grisha verifies execution results
7. Completion or corrective action

#### Session Mode
- Activated during critical failures
- Breaks tasks into micro-steps
- Requires confirmation after each micro-step
- Enhanced monitoring and control

#### Veto System
- Grisha can halt entire process for safety concerns
- 10-second pause followed by user notification
- Only user intervention can resolve veto situations

### File Structure

```
/
├── atlas_backend.py          # Core 3-agent system
├── atlas_web_server.py       # Flask web server
├── atlas_prompts.py          # Dynamic prompt generation
├── requirements.txt          # Python dependencies
├── start_atlas.sh           # System startup script
├── stop_atlas.sh            # System shutdown script  
├── status_atlas.sh          # System status check
├── frontend_new/            # Preserved web interface
│   └── app/
│       ├── templates/       # HTML templates
│       └── static/         # CSS, JS, assets
└── old/                     # Archived legacy code
```

### API Endpoints

- `GET /` - Web interface
- `GET /api/health` - Health check
- `GET /api/system/status` - System status
- `POST /api/tasks` - Create new task
- `GET /api/tasks/<id>` - Get task status
- `GET /api/tasks` - List all tasks
- `POST /api/veto/resolve` - Resolve veto situations
- `POST /api/chat` - Chat interface

### Usage Examples

#### Starting the System
```bash
./start_atlas.sh
```

#### Creating a Task via API
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"description":"Find popular M1 TV clips","user_id":"test"}' \
  http://localhost:5001/api/tasks
```

#### Checking System Status
```bash
./status_atlas.sh
```

### Key Improvements from Legacy System

1. **Agent-Centric Architecture**: Clear separation of agent roles and responsibilities
2. **Prompt-Driven Logic**: No hardcoded behaviors, all dynamic
3. **Enhanced Safety**: Grisha's veto power and session mode
4. **Simplified Deployment**: Single startup script, minimal dependencies
5. **Preserved UI**: Existing web interface design maintained
6. **Better Organization**: Legacy code archived, clean new structure

### Integration Points

#### Goose Integration
- Tetiana agent designed for Goose desktop integration
- Desktop system preferred for higher efficiency
- Command execution through Goose API

#### Web Interface Integration  
- Preserved existing web design (3D models, styling)
- New backend APIs integrate seamlessly
- Real-time agent status monitoring

### Technical Implementation

#### Dynamic Prompt Generation
- Context-aware prompts based on task complexity
- Situational modifiers (urgency, retry count, etc.)
- Agent-specific prompt templates

#### Asynchronous Message Processing
- Agent communication through message queues
- Non-blocking task execution
- Real-time status updates

#### Failure Recovery
- Session mode for critical situations
- Corrective plan generation
- Multi-level retry strategies

This implementation fully satisfies the technical specification requirements while maintaining the existing web interface design and providing a clean, maintainable architecture.
"""

if __name__ == "__main__":
    print(__doc__)