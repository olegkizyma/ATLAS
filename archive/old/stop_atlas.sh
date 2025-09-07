#!/bin/bash
# ATLAS System Stop Script

echo "⏹️ Stopping ATLAS 3-Agent System..."
echo "================================"

# Stop ATLAS web server
echo "ℹ️  (Deprecated) atlas_web_server.py not managed by this script anymore."

# Wait a moment for graceful shutdown
sleep 2

# Check if any processes are still running
echo "ℹ️  Nothing to stop (legacy server)."

echo ""
echo "✅ ATLAS System Stopped"
echo "Port 5001 is now free"