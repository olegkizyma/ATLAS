# ATLAS CI/CD Infrastructure Documentation

## Overview

This document describes the complete CI/CD infrastructure for the ATLAS Pure Intelligent System, implemented after the major refactoring (issue #10) that moved from the old frontend_new system to the new intelligent_atlas architecture.

## Architecture Changes

### Before (Legacy System)
- **frontend_new/**: Flask app on port 5001
- **frontend_new/orchestrator/**: Node.js orchestrator on port 5101
- **TTS**: Ukrainian TTS on port 3001
- **Mixed stack**: Python + Node.js + manual configuration

### After (Pure Intelligent System)
- **intelligent_atlas/**: Pure Python AI-driven system on port 5001
- **Local AI API**: OpenAI-compatible API on port 3010 (REQUIRED)
- **Goose**: Task executor on port 3000 (optional)
- **TTS**: Ukrainian TTS on port 3001 (optional)
- **Zero hardcode**: 100% AI-generated configuration

## Stack Management Scripts

### start_stack_macos.sh
- **Purpose**: Start ATLAS on macOS with Homebrew compatibility
- **Features**:
  - macOS-specific dependency checking (Homebrew, Python, curl)
  - Service discovery and validation
  - Graceful startup with comprehensive logging
  - PID tracking and background execution
  - 30-second startup validation

### start_stack.sh
- **Purpose**: Start ATLAS on Linux with various package managers
- **Features**:
  - Multi-distro support (APT, YUM, Pacman)
  - Python version validation (3.8+)
  - Service discovery and validation
  - Same startup flow as macOS version

### stop_stack.sh
- **Purpose**: Graceful shutdown of all ATLAS components
- **Features**:
  - PID-based process management
  - Graceful SIGTERM followed by SIGKILL if needed
  - Cleanup of temporary files and Python cache
  - Verification of complete shutdown

### status_stack.sh
- **Purpose**: Comprehensive system health monitoring
- **Features**:
  - Process status checking
  - Port usage analysis
  - Service health validation with response time
  - System resource monitoring
  - Status report generation
  - Exit codes: 0 (healthy), 1 (unhealthy), 2 (critical)

## Testing Infrastructure

### Smoke Tests (scripts/smoke_e2e.sh)
- **Required Services**:
  - ATLAS Web Interface (http://localhost:5001/api/health)
  - Local AI API (http://127.0.0.1:3010/v1/models)
- **Optional Services**:
  - Goose Executor (http://127.0.0.1:3000/health)
  - Ukrainian TTS (http://127.0.0.1:3001/health)
- **Behavior**: Fails on required service errors, warns on optional service errors

### CI/CD Validation (scripts/validate_cicd.sh)
- **Purpose**: Validate CI/CD infrastructure without external dependencies
- **Tests**:
  - File structure integrity
  - Script permissions
  - CI/CD configuration validation
  - Service endpoint configuration
  - Documentation updates
  - Python syntax validation

## CI Workflow (.github/workflows/ci.yml)

### Job: intelligent-atlas-tests
- **Purpose**: Primary testing for the new intelligent system
- **Environment**: ubuntu-latest
- **Steps**:
  1. Python 3.11 setup with pip caching
  2. Dependency installation from intelligent_atlas/requirements.txt
  3. Import validation of core modules
  4. Fallback to basic import tests if no test files exist

### Job: legacy-python-tests (conditional)
- **Purpose**: Backward compatibility testing
- **Trigger**: Only if frontend_new/requirements.txt exists
- **Environment**: ubuntu-latest with Node.js 20 for orchestrator

### Job: legacy-node-tests (conditional)
- **Purpose**: Legacy orchestrator testing
- **Trigger**: Only if frontend_new/orchestrator/package.json exists

### Job: e2e-smoke
- **Purpose**: End-to-end system validation
- **Environment**: self-hosted runner (macOS/Linux)
- **Trigger**: Only on push to master/main (not PR)
- **Dependencies**: Requires intelligent-atlas-tests to pass
- **Steps**:
  1. Environment preparation
  2. Stack startup (30s initialization)
  3. Status validation
  4. Smoke test execution
  5. Graceful shutdown

## Deployment Workflow (.github/workflows/macos-deployment.yml)

### Job: validate-macos
- **Purpose**: macOS-specific validation
- **Environment**: macos-latest
- **Outputs**: validation_status for downstream jobs
- **Features**:
  - System dependency validation
  - Python import structure testing
  - Dynamic configuration system validation
  - Script permission verification

### Job: deploy-staging
- **Purpose**: Automatic staging deployment
- **Environment**: self-hosted runner
- **Triggers**: Push to master OR manual dispatch with staging target
- **Features**:
  - Existing instance cleanup
  - Environment preparation
  - Pre-deployment health checks
  - ATLAS deployment with 30s initialization
  - Post-deployment smoke tests
  - Deployment report generation

### Job: deploy-production
- **Purpose**: Production deployment with safeguards
- **Environment**: self-hosted runner
- **Triggers**: Manual dispatch with production target AND successful staging
- **Features**:
  - Production backup creation
  - Extended validation (45s initialization)
  - Comprehensive health checks
  - Rollback capabilities

## Dependency Management (.github/dependabot.yml)

### intelligent_atlas (Primary)
- **Frequency**: Weekly (Monday 09:00)
- **Scope**: Direct and indirect Python dependencies
- **Limits**: 5 open PRs
- **Labels**: dependencies, intelligent-atlas

### Legacy Systems
- **frontend_new**: Weekly Python deps (Monday 10:00)
- **orchestrator**: Weekly Node.js deps (Tuesday 09:00)
- **Goose Rust**: Monthly (first Monday 09:00)
- **Electron desktop**: Monthly (second Monday 09:00)

### GitHub Actions
- **Frequency**: Monthly (third Monday 09:00)
- **Scope**: All workflow action updates
- **Labels**: dependencies, github-actions, ci/cd

## Service Architecture

### Port Allocation
- **5001**: ATLAS Web Interface (new intelligent system)
- **3010**: Local AI API (REQUIRED - OpenAI-compatible)
- **3000**: Goose Executor (optional - real task execution)
- **3001**: Ukrainian TTS (optional - voice synthesis)

### Service Dependencies
```
ATLAS Web (5001)
├── REQUIRES: Local AI API (3010)
├── OPTIONAL: Goose (3000) - for Tetyana agent execution
└── OPTIONAL: TTS (3001) - for voice features

Local AI API (3010)
├── Examples: Ollama, LM Studio, LocalAI
└── Must be OpenAI-compatible

Goose (3000)
├── Enables real task execution
└── Used by Tetyana agent

TTS (3001)
├── Ukrainian voice synthesis
└── Whisper integration
```

## Self-Hosted Runner Requirements

### macOS Runner
- **OS**: macOS (any recent version)
- **Python**: 3.8+ on PATH
- **Tools**: curl, homebrew (recommended)
- **Services**: Local AI API on port 3010
- **Permissions**: Execute project scripts, manage processes

### Linux Runner
- **OS**: Ubuntu/CentOS/Arch Linux
- **Python**: 3.8+ with pip and venv
- **Tools**: curl, package manager (apt/yum/pacman)
- **Services**: Local AI API on port 3010
- **Permissions**: Execute project scripts, manage processes

## Environment Variables

### CI/CD Variables
- **ATLAS_WEB_PORT**: 5001 (default)
- **ATLAS_AI_API_URL**: http://127.0.0.1:3010
- **ATLAS_GOOSE_URL**: http://127.0.0.1:3000
- **ATLAS_TTS_URL**: http://127.0.0.1:3001

### Runtime Variables (set by scripts)
- **ATLAS_MODE**: intelligent
- **ATLAS_CONFIG_TYPE**: dynamic
- **ATLAS_GOOSE_AVAILABLE**: true/false
- **ATLAS_TTS_AVAILABLE**: true/false
- **PYTHONPATH**: Extended with intelligent_atlas paths

## Error Handling and Recovery

### Startup Failures
1. **Critical Service Missing**: Exit with error and guidance
2. **Optional Service Missing**: Continue with warnings
3. **Timeout**: 30s initialization, then validation
4. **Port Conflicts**: Detect and report busy ports

### Deployment Failures
1. **Staging Failure**: Block production deployment
2. **Validation Failure**: Rollback to previous version
3. **Health Check Failure**: Attempt graceful recovery
4. **Process Failure**: Kill and restart with logging

### Monitoring and Alerting
1. **Status Reports**: Generated every status check
2. **Log Retention**: 7 days for routine logs
3. **Error Tracking**: Persistent error logs
4. **Health Checks**: Continuous service monitoring

## Migration Notes

### From Legacy System
- **Configuration**: Migrated from hardcoded to AI-generated
- **Architecture**: Single Python service vs. multi-service
- **Dependencies**: Reduced from Python+Node.js to Python-only
- **Deployment**: Simplified from multi-component to single-stack

### Backward Compatibility
- **Legacy tests**: Maintained conditionally
- **Old scripts**: Archived in archive/old_scripts/
- **Documentation**: Preserved in old2/ directory
- **Data**: No migration required (stateless system)

## Troubleshooting Guide

### Common Issues
1. **AI API Not Available**: Start Ollama or LM Studio on port 3010
2. **Python Import Errors**: Ensure dependencies installed in venv
3. **Permission Denied**: Run chmod +x on all scripts
4. **Port Conflicts**: Check lsof -i:PORT and kill conflicting processes
5. **Smoke Test Failures**: Verify all required services are running

### Debugging Commands
```bash
# Check system status
./status_stack.sh

# View logs
tail -f logs/atlas_intelligent.log

# Validate CI/CD setup
./scripts/validate_cicd.sh

# Test smoke endpoints
./scripts/smoke_e2e.sh

# Manual service check
curl http://localhost:5001/api/health
curl http://127.0.0.1:3010/v1/models
```

## Security Considerations

### Secrets Management
- **Local Development**: No secrets required
- **CI/CD**: GitHub secrets for API keys if needed
- **Production**: Environment-based secret injection

### Network Security
- **Localhost Binding**: All services bind to 127.0.0.1
- **No External Exposure**: No internet-facing services by default
- **Process Isolation**: Each service runs in separate Python venv

### Access Control
- **File Permissions**: Executable scripts, read-only configs
- **Process Management**: PID-based tracking and cleanup
- **Resource Limits**: Memory and CPU limits via configuration

This infrastructure provides a robust, automated, and maintainable CI/CD pipeline for the ATLAS Pure Intelligent System while maintaining backward compatibility with legacy components.