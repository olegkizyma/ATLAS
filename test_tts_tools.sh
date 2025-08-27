#!/bin/bash

# Test Ukrainian TTS MCP Server Tools

cd /Users/dev/Documents/GitHub/ATLAS/goose
source bin/activate-hermit

echo "🎙️ Testing Ukrainian TTS MCP Server Tools..."

(
  echo '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "test-client", "version": "1.0.0"}}}'
  sleep 0.5
  echo '{"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}'
  sleep 0.5
  echo '{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "list_voices", "arguments": {}}}'
  sleep 1
) | timeout 15s ./target/release/goose mcp ukrainian-tts

echo ""
echo "✅ Test completed!"
