#!/usr/bin/env bash
# Simple health check that doesn't require running services
set -euo pipefail

echo "[HEALTH] Checking ATLAS repository health..."

# Check required files exist
REQUIRED_FILES=(
    "frontend_new/app/atlas_server.py"
    "frontend_new/orchestrator/server.js"
    "frontend_new/requirements.txt"
    "frontend_new/orchestrator/package.json"
)

for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file exists"
    else
        echo "❌ $file missing"
        exit 1
    fi
done

# Check basic syntax
echo "[HEALTH] Checking Python syntax..."
python3 -m py_compile frontend_new/app/atlas_server.py || exit 1

echo "[HEALTH] Checking Node.js syntax..."
node -c frontend_new/orchestrator/server.js || exit 1

echo "✅ ATLAS repository health check passed"
