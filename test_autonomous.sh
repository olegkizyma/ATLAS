#!/bin/bash

# Quick test script for the ATLAS autonomous system
echo "🧠 Starting ATLAS Autonomous System Test"

# Start the orchestrator in background
echo "🚀 Starting orchestrator..."
cd frontend_new/orchestrator
node server.js &
ORCH_PID=$!

# Wait for startup
sleep 5

# Start the Python frontend in background  
echo "🐍 Starting Python frontend..."
cd ../app
python3 atlas_server.py &
PYTHON_PID=$!

# Wait for full startup
sleep 8

echo "✅ System started. Testing..."

# Run the autonomous tests
cd ../../
node test_autonomous_system.js

TEST_RESULT=$?

# Cleanup
echo "🛑 Stopping services..."
kill $ORCH_PID 2>/dev/null
kill $PYTHON_PID 2>/dev/null

# Wait a moment for cleanup
sleep 2

if [ $TEST_RESULT -eq 0 ]; then
    echo "🎉 Autonomous system test PASSED"
else
    echo "❌ Autonomous system test FAILED"
fi

exit $TEST_RESULT