#!/bin/bash
# Simple launcher for the 3D helmet viewer on port 8080
# Ensures convenient CORS env example for Atlas Core.

set -e
PORT=8080
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f index.html ]; then
  echo "[ERROR] index.html not found in $SCRIPT_DIR" >&2
  exit 1
fi

echo "🚀 Starting 3D Helmet Viewer on http://localhost:$PORT"
echo "📄 Root file: index.html"

echo "ℹ️  If Atlas Core not started with CORS yet, run in another terminal before starting core:"
echo "    export ATLAS_ENABLE_CORS=1"
echo "    export ATLAS_ALLOWED_ORIGINS=http://localhost:$PORT,http://127.0.0.1:$PORT"
echo "(Then start: ./start_atlas.sh)"

echo "🌐 Open: http://localhost:$PORT/"
python3 -m http.server "$PORT" --bind 127.0.0.1
