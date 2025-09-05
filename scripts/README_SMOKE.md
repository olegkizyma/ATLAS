ATLAS Pure Intelligent System - Smoke Tests
==========================================

This repo includes a lightweight smoke script to verify that core services are reachable.

Usage
-----

1) Ensure the intelligent stack is running:
   - macOS: `./start_stack_macos.sh`
   - Linux: `./start_stack.sh`

2) Run the smoke script:
   - `./scripts/smoke_e2e.sh`

Checks performed
----------------
- ATLAS Web Interface:   GET http://localhost:5001/api/health (REQUIRED)
- Local AI API:          GET http://127.0.0.1:3010/v1/models (REQUIRED)
- Goose Executor:        GET http://127.0.0.1:3000/health (OPTIONAL)
- Ukrainian TTS:         GET http://127.0.0.1:3001/health (OPTIONAL)

Exit code will be non-zero if any required check fails.
Optional services generate warnings but don't fail the test.

CI
--
The GitHub Actions workflow `.github/workflows/ci.yml` runs unit tests for Python and Node (legacy). 
The new intelligent system uses only Python with dynamic configuration.

The e2e smoke script is intended for local use after `start_stack_*` scripts and in CI.

Self-hosted runner for E2E
--------------------------
To enable the `e2e-smoke` job in CI, configure a self-hosted runner with:
- macOS or Linux host
- Python 3.8+ available on PATH
- Node.js 20.x on PATH (for legacy components)
- curl installed
- Permissions to execute project scripts

The job will:
1) Start the stack via `start_stack_macos.sh` (or `start_stack.sh` fallback)
2) Wait ~30s for services to warm up
3) Run `scripts/smoke_e2e.sh`
4) Stop the stack via `stop_stack.sh`

ATLAS Pure Intelligent System Architecture
------------------------------------------
The new system operates on these principles:
- Port 5001: ATLAS Web Interface (pure intelligent multi-agent system)
- Port 3010: Local AI API (REQUIRED - OpenAI-compatible, e.g., Ollama, LM Studio)
- Port 3000: Goose Executor (OPTIONAL - for real task execution via Tetyana agent)
- Port 3001: Ukrainian TTS (OPTIONAL - for voice synthesis)

The system uses three agents:
- Atlas: Strategic planner (AI-driven decisions)
- Tetyana: Task executor (via Goose when available)
- Grisha: Quality validator (AI + execution verification)

All configuration is generated dynamically via AI - zero hardcoded values.
