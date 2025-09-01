# ATLAS - Intelligent Multi-Agent System

## Overview

ATLAS is a fully intelligent multi-agent orchestration system designed for autonomous task execution with advanced failure recovery capabilities. The system operates without hardcoded values, using machine learning and adaptive intelligence to handle complex workflows.

## Architecture

### Core Components

- **Goose Web Interface** (Port 3000) - Primary user interface and task management
- **Node.js Orchestrator** (Port 5101) - Workflow coordination and agent management  
- **Python Frontend** (Port 5001) - Advanced processing and intelligent recovery
- **Intelligent Recovery System** (Port 5102) - WebSocket-based failure recovery bridge

### Multi-Agent Framework

- **Atlas Agent** (Gemini) - Strategic planning and high-level coordination
- **Grisha Agent** (Mistral) - Technical implementation and code generation
- **Tetiana Agent** (Goose) - Quality assurance and validation
- **Recovery Agent** (Python) - Intelligent failure analysis and adaptive recovery

## Intelligent Features

### Failure Recovery System

The system includes advanced failure recovery with 7 failure types and 7 recovery strategies:

**Failure Types:**
- Context limit violations
- Rate limit exceeded  
- Agent communication failures
- Resource exhaustion
- Authentication errors
- Network connectivity issues
- Execution timeouts

**Recovery Strategies:**
- Context optimization and summarization
- Exponential backoff with jitter
- Agent failover and redundancy
- Resource reallocation
- Credential refresh and re-authentication
- Connection retry with circuit breaker
- Task decomposition and parallel execution

### Adaptive Learning

- **Performance Monitoring** - Real-time tracking of agent efficiency
- **Pattern Recognition** - Identification of recurring issues and optimal solutions
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

## Development

### Project Structure

```
/
├── frontend/           # Python intelligent recovery system
├── frontend_new/       # Node.js orchestrator
├── goose/             # Goose CLI integration
├── logs/              # Runtime logs and monitoring
├── scripts/           # Deployment and maintenance
└── arhiv/             # Archived legacy components
```

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
