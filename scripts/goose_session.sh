#!/usr/bin/env bash
# Wrapper to run 'goose session' with a safe TMPDIR inside the allowed sessions directory
set -euo pipefail

GOOSE_BIN="${GOOSE_BIN:-}"
if [ -z "$GOOSE_BIN" ]; then
  if [ -x "$(pwd)/goose/target/release/goose" ]; then
    GOOSE_BIN="$(pwd)/goose/target/release/goose"
  elif command -v goose >/dev/null 2>&1; then
    GOOSE_BIN="$(command -v goose)"
  elif [ -x "$HOME/.local/bin/goose" ]; then
    GOOSE_BIN="$HOME/.local/bin/goose"
  else
    echo "Goose binary not found. Build it in goose/ or install to ~/.local/bin/goose" >&2
    exit 1
  fi
fi

# Ensure sessions dir exists and set TMPDIR to it to satisfy Goose storage guardrails
SESS_DIR="$HOME/.local/share/goose/sessions"
mkdir -p "$SESS_DIR"

# Ensure config points to repo config if running from repo
REPO_GOOSE_CONF_DIR="$(pwd)/goose/goose"
if [ -d "$REPO_GOOSE_CONF_DIR" ]; then
  export XDG_CONFIG_HOME="$(pwd)/goose"
fi

export TMPDIR="$SESS_DIR"
exec "$GOOSE_BIN" session "$@"
