# ATLAS Local Fallback LLM (OpenAI-compatible)

Purpose: a drop-in local proxy for chat when primary providers fail (429, 5xx, timeouts).

- Base URL: http://localhost:3010/v1
- Endpoints: GET /v1/models, POST /v1/chat/completions
- Auth: not enforced; provide any string (e.g., dummy-key)
- Streaming: not supported (stream=true -> 400)
- Input token cap: ~8000 tokens (trim upstream).

Wire into orchestrator:

- Orchestrator picks base from env FALLBACK_API_BASE. Default: http://localhost:3010/v1
- To override: export FALLBACK_API_BASE=http://127.0.0.1:3010/v1

Run:

```bash
cd fallback_llm
./start_fallback.sh
```

See ../../LLM_FolBack.md for full usage and model list.
