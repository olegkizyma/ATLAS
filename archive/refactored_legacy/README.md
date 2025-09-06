# Legacy Components Archive

## Phase 2 Refactor Completion

This directory contains legacy components that were identified during the Phase 2 refactoring process. These components are archived for historical reference but are no longer actively used in the system.

## Archived Components

### Discussion Logic
- **Reason**: Low usage (<1% as per requirements)
- **Status**: To be archived once usage metrics confirm threshold
- **Location**: Will be moved from orchestrator/server.js to this directory

### Legacy Intent Classification
- **Original**: Basic keyword-based intent detection
- **Replaced by**: LLM-based intent router with caching
- **Migration date**: Phase 2 completion

### Mock Simulation Logic
- **Original**: `simulateAgentThinking()` with random text generation
- **Replaced by**: Deterministic fallback with structured responses
- **Migration date**: Phase 2 completion

### Legacy Circuit Breaker
- **Original**: Simple failure counting
- **Replaced by**: Full circuit breaker pattern with cooldown metrics
- **Migration date**: Phase 2 completion

## Usage Guidelines

1. **Do not import or reference** components in this directory from active code
2. **Historical reference only** - for understanding evolution of the system
3. **Documentation purposes** - to understand previous approaches and decisions
4. **Testing reference** - legacy test patterns that might be useful for new implementations

## Restoration Process

If a legacy component needs to be restored:

1. Review the archived component for compatibility
2. Update dependencies and APIs to match current system
3. Add appropriate tests
4. Document the restoration reason
5. Move back to active codebase with proper integration

## Archive Metadata

- **Archive Date**: September 6, 2025
- **Refactor Phase**: Phase 2 Completion
- **Archived By**: Atlas Refactoring Process
- **Total Components**: TBD (pending discussion logic usage analysis)
