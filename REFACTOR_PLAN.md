# ATLAS Refactor Plan (Frontend_new Focus)

## Root Causes (Tasks not executing / duplication / late execution)
1. **Deferred execution design**: Orchestrator stages actionable tasks (Atlas plan -> Grisha precheck) and only triggers Tetyana real execution after `/chat/continue` is called by frontend (after TTS idle). If TTS or the JS pipeline stalls, real execution appears "at the end" only.
2. **Duplicate Grisha messages**: Multiple sequential Grisha validations:
   - Precheck (pre-execution)
   - Immediate plan critique (planning branch)
   - Post-execution verdict
   - Follow-up evidence request(s) per iteration
   This reads to user as duplicates because signatures are identical and no phase labels.
3. **No phase tagging**: Responses lack metadata (phase=precheck|verdict|followup) so UI cannot group/dedupe.
4. **Fallback simulation**: When provider routing fails, `simulateAgentThinking()` produces generic text causing noise and weak evidence.
5. **Tool execution gap**: Goose tool usage attempted only with `enableTools` during execution; WebSocket path ignores tools; SSE fallback doesn’t surface tool call results in structured form.
6. **Orchestrator complexity**: `server.js` mixes: routing, intent classification, execution pipeline, provider registry, validation logic, SSE/WebSocket adapters.
7. **Unused / stale modules**: `intent_router.py` (LLM based) present but not invoked in current orchestrator flow; legacy test suite not active; some dynamic discussion logic rarely triggered.
8. **Evidence verification loop risk**: Iterative loop uses confidence threshold without decay control; can produce repetitive Grisha follow-ups.

## Refactor Objectives
1. Make execution start predictably (option to execute immediately without TTS wait).
2. Consolidate Grisha phases and label them to avoid visual duplication.
3. Introduce structured response envelope: `{agent, phase, content, provider, model, evidence, status}`.
4. Extract execution pipeline into separate module `pipeline.js`.
5. Provide graceful minimal fallback (single structured notice) instead of multiple simulated messages.
6. Integrate `intent_router.py` optionally via lightweight HTTP call from orchestrator for first intent (feature flag INTENT_ROUTER=1).
7. Archive unused or legacy components into `archive/refactored_legacy/`.
8. Add tests: execution pipeline, grisha phase tagging, immediate execution mode.

## Incremental Steps (Progress)
Status legend: ✓ done, ▶ in progress, ○ pending

1. ✓ `pipeline.js` created (phase enum, execution mode helpers).
2. ✓ `server.js` emits phase tags (verdict & follow-up distinct; collapse heuristic optional, deferred).
3. ✓ `EXECUTION_MODE` env (immediate|staged) implemented.
4. ✓ Phase labels integrated into frontend HUD (progress %, confidence injection).
5. ✓ Replaced `simulateAgentThinking` with deterministic fallback + metric `mockExecutions`.
6. ○ `/intent` proxy endpoint (INTENT_ROUTER flag) not yet implemented.
7. ○ Discussion logic archival deferred (needs usage metric <1%).
8. ✓ Core tests added (immediate/staged pipeline, phase tagging, provider state). Additional tests pending (evidence extraction, circuit breaker cooldown, metrics endpoint).

## Risk Mitigation
 - Keep existing endpoints stable (`/chat`, `/chat/continue`).
 - Feature flag new behavior to allow rollback.
 - Logging: add `[PIPELINE]` prefix for new pipeline events.

## Success Criteria
 - No duplicated Grisha messages per phase (max 1 precheck + 1 verdict + optional 1 followup per iteration).
 - Real execution (Tetyana) starts either immediately (immediate mode) or after at most one frontend cycle.
 - Confidence loop terminates respecting GRISHA_MAX_VERIFY_ITER with clear final status.
 - All tests pass.

## Next Implementation Actions (Phase 1)
 - Create pipeline module scaffold.
 - Introduce phase tagging in `generateAgentResponse` return object.
 - Add EXECUTION_MODE handling in /chat.

---
Document generated as part of refactor initiation.

## Phase 2 (Updated Progress)
Focus: deeper modularization, observability, tooling evidence.

1. ✓ Goose integration extracted (`goose_adapter.js`).
2. ▶ Evidence extractor enhanced (files/commands/outputs/summary) attached to execution & verdict criteria (refinement + weighting pending).
3. ✓ Deterministic fallback done.
4. ▶ Circuit-breaker metrics (failuresTotal, cooldownRemaining) surfaced via `/metrics/pipeline`; add cooldown test & HUD display.
5. ▶ Additional tests to add: `evidence_extraction.test.js`, `circuit_breaker_cooldown.test.js`, `metrics_endpoint.test.js`.
6. ○ `/intent` proxy + LRU (64) caching.
7. ○ Archive or modularize discussion logic once low usage confirmed.
8. ✓ `/metrics/pipeline` endpoint live (includes provider snapshot + aggregations).

Exit criteria Phase 2:
- 95% reduction duplicate Grisha messages in staging logs.
- All new tests pass locally.
- Evidence object appears in verification flow payloads.
 - Circuit breaker metrics validated by tests.
 - Fallback usage rate (<5% of actionable requests) observed over sample window.