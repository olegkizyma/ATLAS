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
