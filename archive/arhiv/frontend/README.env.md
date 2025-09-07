# Frontend environment configuration

Place a copy of `.env.example` as `.env` in the `frontend/` folder to configure the server and integrations.

## Variables

- ATLAS_PORT
  - Port for the minimal frontend server
  - Default: 8080
- ATLAS_PARAPHRASE
  - Enable prompt paraphrasing for task mode
  - Values: 1/true, 0/false
  - Default: 1
- GOOSE_BASE_URL
  - Goose Web or goosed base URL (auto-detected if unset)
  - Example: http://127.0.0.1:3000
- GOOSE_SECRET_KEY
  - Optional secret value used as X-Secret-Key header for /reply
  - Default: "test"
- ATLAS_CORE_URL
  - Atlas Core base URL for orchestration and remote TTS provider
  - Example: http://127.0.0.1:8000
- UKRAINIAN_TTS_URL
  - Local Ukrainian TTS HTTP endpoint
  - Example: http://127.0.0.1:3000/tts
- TTS_PROVIDER_DEFAULT
  - Default TTS provider if agent-specific setting not provided
  - Values: local | gemini | google
  - Default: local
- TTS_VOICE_DEFAULT
  - Fallback voice name for all agents
  - Default: default
- TTS_PROVIDER_{AGENT}
  - Agent-specific TTS provider override (AGENT = ATLAS | GOOSE | GRISHA)
  - Example: TTS_PROVIDER_ATLAS=gemini
- TTS_VOICE_{AGENT}
  - Agent-specific voice override
  - Example: TTS_VOICE_GOOSE=uk-male-1

## Notes
- If both GOOSE_BASE_URL and goosed are running locally, the client will auto-detect the first available endpoint.
- Paraphrasing is disabled in chat mode, enabled by default in task mode.
- Remote providers (gemini/google) are proxied via Atlas Core /tts.
