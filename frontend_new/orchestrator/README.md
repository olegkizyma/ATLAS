# Atlas Orchestrator (Node.js)

Agents:
  - Atlas (Gemini, LLM1)
  - Grisha (Mistral, LLM2)
  - Tetiana (Goose Web)
Prompts live in `intelligeich.json`.
SSE endpoint: `POST /chat/stream` with JSON `{ message, sessionId? }`.

## Env (.env)
- ORCH_PORT=5101
- GOOSE_BASE_URL=http://127.0.0.1:3000
- GEMINI_API_KEY=...
- GEMINI_API_URL=https://generativelanguage.googleapis.com/v1beta
- GEMINI_MODEL=gemini-1.5-flash
- MISTRAL_API_KEY=...
- MISTRAL_MODEL=mistral-small-latest

## Run
1) Start Goose:
   cd /Users/dev/Documents/GitHub/ATLAS/goose && /Users/dev/Documents/GitHub/ATLAS/goose/target/release/goose web --port 3000
2) Install deps:
   npm install
3) Start orchestrator:
   npm run start

Then POST to http://127.0.0.1:5101/chat/stream (SSE).