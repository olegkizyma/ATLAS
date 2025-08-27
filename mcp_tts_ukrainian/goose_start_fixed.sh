#!/bin/bash

# Wrapper for Goose Desktop to launch the fixed Ukrainian TTS MCP server

set -euo pipefail

# Go to repo dir
cd "$(dirname "$0")"

# Ensure venv exists and activate
VENV_PATH="../atlas_venv"
if [ -d "$VENV_PATH" ]; then
  # shellcheck disable=SC1090
  source "$VENV_PATH/bin/activate"
fi

# Ensure script is executable
chmod +x ./start_fixed.sh || true

# Run fixed server in foreground (stdio)
exec /bin/bash ./start_fixed.sh


