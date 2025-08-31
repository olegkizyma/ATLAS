#!/bin/bash
# Wrapper script to run goose cli within the hermit environment

# Absolute path to the goose directory
GOOSE_DIR="/Users/dev/Documents/GitHub/ATLAS/goose"

# Change to the goose directory to ensure hermit and goose are found
cd "$GOOSE_DIR" || exit 1

# Activate hermit environment
source "bin/activate-hermit"

# Run the goose command with all arguments passed to this script
./target/debug/goose "$@"
