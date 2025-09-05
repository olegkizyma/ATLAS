ATLAS Smoke Tests
=================

This repo includes a lightweight smoke script to verify that core services are reachable.

Usage
-----

1) Ensure the stack is running:
   - macOS: `./start_stack_macos.sh`
   - Linux: `./start_stack.sh`

2) Run the smoke script:
   - `./scripts/smoke_e2e.sh`

Checks performed
----------------
- Flask Frontend Health: GET http://localhost:5001/api/health
- Orchestrator Health:   GET http://localhost:5101/health
- TTS Health:            GET http://127.0.0.1:3001/health

Exit code will be non-zero if any check fails.

CI
--
The GitHub Actions workflow `.github/workflows/ci.yml` runs unit tests for Python and Node. The e2e smoke script is intended for local use after `start_stack_*` scripts.

Self-hosted runner for E2E
--------------------------
To enable the `e2e-smoke` job in CI, configure a self-hosted runner with:
- macOS or Linux host
- Python 3.11 available on PATH
- Node.js 20.x on PATH
- curl installed
- Permissions to execute project scripts

The job will:
1) Start the stack via `start_stack_macos.sh` (or `start_stack.sh` fallback)
2) Wait ~30s for services to warm up
3) Run `scripts/smoke_e2e.sh`
4) Stop the stack via `stop_stack.sh`
