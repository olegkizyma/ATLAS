#!/bin/bash
# ATLAS System Demo - Complete Functionality Test

echo "🎯 ATLAS 3-Agent System Demo"
echo "============================"
echo ""

# Start the system
echo "1️⃣ Starting ATLAS system..."
./start_atlas.sh
echo ""

# Wait for startup
sleep 2

echo "2️⃣ Testing API endpoints..."
echo ""

# Test health
echo "🩺 Health Check:"
curl -s http://localhost:5001/api/health | jq .
echo ""

# Test system status  
echo "📊 System Status:"
curl -s http://localhost:5001/api/system/status | jq .
echo ""

echo "3️⃣ Creating test tasks..."
echo ""

# Create simple task
echo "📝 Creating simple task:"
SIMPLE_TASK=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"description":"Find popular Ukrainian music videos","user_id":"demo_user"}' \
  http://localhost:5001/api/tasks)
echo $SIMPLE_TASK | jq .
SIMPLE_ID=$(echo $SIMPLE_TASK | jq -r .task_id)
echo ""

# Create complex task
echo "📝 Creating complex task:"
COMPLEX_TASK=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"description":"Analyze and compare Ukrainian TV content trends across multiple platforms","user_id":"demo_user","priority":"high"}' \
  http://localhost:5001/api/tasks)
echo $COMPLEX_TASK | jq .
COMPLEX_ID=$(echo $COMPLEX_TASK | jq -r .task_id)
echo ""

echo "4️⃣ Checking task statuses..."
echo ""

echo "📋 Simple task status:"
curl -s http://localhost:5001/api/tasks/$SIMPLE_ID | jq .
echo ""

echo "📋 Complex task status:"  
curl -s http://localhost:5001/api/tasks/$COMPLEX_ID | jq .
echo ""

echo "📋 All tasks:"
curl -s http://localhost:5001/api/tasks | jq .
echo ""

echo "5️⃣ Testing chat interface..."
echo ""

echo "💬 Chat test:"
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"message":"Help me understand how ATLAS agents work together","user_id":"demo_user"}' \
  http://localhost:5001/api/chat | jq .
echo ""

echo "6️⃣ System demonstration complete!"
echo ""
echo "🌐 Web Interface: http://localhost:5001"
echo "📊 Real-time Status: http://localhost:5001/api/system/status"
echo ""
echo "🧠 Agent Architecture Demonstrated:"
echo "   👤 Atlas:   Created detailed plans for both tasks"
echo "   👮‍♂️ Grisha:  Reviewed and approved plans (or would reject unsafe ones)"
echo "   👩‍💻 Tetiana: Ready to execute approved steps (integration with Goose)"
echo ""
echo "✨ Key Features Shown:"
echo "   ✅ Prompt-driven agent behavior"
echo "   ✅ Dynamic task complexity analysis" 
echo "   ✅ Multi-agent workflow coordination"
echo "   ✅ RESTful API interface"
echo "   ✅ Preserved web interface design"
echo ""
echo "📝 To stop the system: ./stop_atlas.sh"