#!/bin/bash
# Production startup script for ATLAS with improved logging

export FLASK_DEBUG=false
export ATLAS_PRODUCTION=true

# Create logs directory
mkdir -p logs

echo "Starting ATLAS in production mode..."
echo "Logging health checks suppressed, debug mode disabled"

# Start services with production settings
cd frontend_new

# Check if gunicorn is available
if command -v gunicorn &> /dev/null; then
    echo "Starting frontend with gunicorn (production mode)..."
    gunicorn -w 4 -b 0.0.0.0:5001 --access-logfile ../logs/frontend_access.log --error-logfile ../logs/frontend_error.log production_server:create_app &
    echo $! > ../logs/frontend.pid
else
    echo "Gunicorn not found, starting with Flask (development mode)..."
    python app/atlas_server.py > ../logs/frontend.log 2>&1 &
    echo $! > ../logs/frontend.pid
fi

cd ..

# Start other services
cd frontend_new/orchestrator
npm start > ../../logs/orchestrator.log 2>&1 &
echo $! > ../../logs/orchestrator.pid
cd ../..

# Start recovery bridge if available
if [ -f "frontend_new/config/recovery_bridge.py" ]; then
    echo "🔄 Starting Recovery Bridge on port 5102..."
    cd frontend_new/config
    if [ -d "../venv" ]; then
        source ../venv/bin/activate && python recovery_bridge.py > ../../logs/recovery_bridge.log 2>&1 &
    else
        python3 recovery_bridge.py > ../../logs/recovery_bridge.log 2>&1 &
    fi
    echo $! > ../../logs/recovery_bridge.pid
    cd ../..
fi

# Start TTS server with health check suppression and virtual environment
echo "🎵 Starting TTS server on port 3001..."
cd ukrainian-tts
if [ -d ".venv" ]; then
    source .venv/bin/activate && python tts_server.py > ../logs/tts_server.log 2>&1 &
else
    python3 tts_server.py > ../logs/tts_server.log 2>&1 &
fi
echo $! > ../logs/tts.pid
cd ..

echo "ATLAS production startup completed."
echo "Health check logging suppressed for cleaner logs."
echo "View logs: tail -f logs/*.log"
