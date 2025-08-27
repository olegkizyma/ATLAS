#!/bin/bash

# Test Ukrainian TTS MCP Server

cd /Users/dev/Documents/GitHub/ATLAS/goose
source bin/activate-hermit

echo "🎙️ Testing Ukrainian TTS MCP Server..."

# Test initialize request
echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}' | timeout 10s ./target/release/goose mcp ukrainian-tts

echo ""
echo "✅ Test completed!"
