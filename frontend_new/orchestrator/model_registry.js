// Dynamic Model/Provider Registry for Orchestrator
// - Tracks health of providers (Goose, OpenAI-compatible, etc.)
// - Provides ordered routes per agent with rotation and cooldowns
// - Independent of Goose UI; configured via env and sane defaults

import axios from 'axios';

const now = () => Date.now();

export class ModelRegistry {
    constructor(options = {}) {
        // Configuration
        this.healthTimeoutMs = options.healthTimeoutMs ?? 1500;
        this.failureThreshold = options.failureThreshold ?? 3; // consecutive failures before cooldown
        this.cooldownMs = options.cooldownMs ?? 30_000; // cooldown period after threshold reached
        this.healthIntervalMs = options.healthIntervalMs ?? 20_000; // periodic health check

        // Model blacklist tracking (for individual model failures)
        this.modelFailures = new Map(); // modelId -> { count, lastFailure, cooledUntil }
        this.modelFailureThreshold = 3; // failures before temporary blacklist
        this.modelCooldownMs = 60_000; // 1 minute cooldown for failing models

        // Providers
        const gooseBase = (process.env.GOOSE_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
        const openaiCompatBase = (process.env.FALLBACK_API_BASE || 'http://127.0.0.1:3010/v1').replace(/\/$/, '');

        // Helper: parse a comma/whitespace separated env var into a unique array of model names
        const parseModels = (envNames, fallback) => {
            const names = Array.isArray(envNames) ? envNames : [envNames];
            for (const n of names) {
                const raw = (process.env[n] || '').trim();
                if (raw) {
                    const list = raw
                        .split(/[\n,]/)
                        .map(s => s.trim())
                        .filter(Boolean);
                    // de-duplicate keeping order
                    const seen = new Set();
                    const uniq = [];
                    for (const m of list) { if (!seen.has(m)) { seen.add(m); uniq.push(m); } }
                    if (uniq.length) return uniq;
                }
            }
            return fallback;
        };

        // Default list prioritizing quality first, then speed (quality-first approach)
        const defaultTetyanaModels = [
            'openai/o3',                            // Найновіша якісна модель
            'openai/gpt-4o',                        // 18 req/min - висока якість
            'xai/grok-3',                           // 6 req/min - високоякісна
            'openai/gpt-5-nano',                    // 20 req/min - нова якісна
            'mistral-ai/ministral-3b',              // 45 req/min - найшвидший
            'microsoft/phi-3-mini-4k-instruct',     // 40 req/min
            'mistral-ai/mistral-small-2503',        // 40 req/min  
            'microsoft/phi-3.5-mini-instruct',      // 38 req/min
            'openai/gpt-4o-mini',                   // 35 req/min
            'microsoft/phi-3-mini-128k-instruct',   // 35 req/min
            'meta/meta-llama-3.1-8b-instruct',     // 30 req/min
            'openai/gpt-4.1-mini',                  // 30 req/min
            'microsoft/phi-3-small-8k-instruct',   // 30 req/min
            'microsoft/phi-3-small-128k-instruct',  // 28 req/min
            'ai21-labs/ai21-jamba-1.5-mini',       // 25 req/min
            'microsoft/phi-4-mini-instruct',        // 22 req/min
            'openai/o4-mini',                       // 20 req/min
            'mistral-ai/mistral-medium-2505',       // 18 req/min
            'xai/grok-3-mini'                       // 18 req/min
        ];

        // Load extended list for Tetyana short-report summarization
        const tetyanaTextModels = parseModels(['TETYANA_TEXT_MODELS', 'TETYANA_TEXT_MODELS_58'], defaultTetyanaModels);

        // Atlas advanced reasoning models - якість перш за все
        const defaultAtlasModels = parseModels(['ATLAS_TEXT_MODELS'], [
            'openai/o3',                            // Найновіша якісна модель
            'openai/gpt-4o',                        // 18 req/min - проверена висока якість
            'xai/grok-3',                           // 6 req/min - найкраще міркування
            'openai/gpt-5-nano',                    // 20 req/min - нова якісна
            'openai/gpt-4.1',                       // 12 req/min
            'mistral-ai/mistral-large-2411',        // 6 req/min
            'microsoft/phi-4',                      // 8 req/min
            'openai/o1-mini'                        // 16 req/min
        ]);

        this.providers = {
            goose: {
                name: 'goose',
                type: 'goose',
                baseUrl: gooseBase,
                healthy: null,
                lastLatencyMs: null,
                lastCheckAt: 0,
                consecutiveFailures: 0,
                cooldownUntil: 0,
                failuresTotal: 0
            },
            openai_compat: {
                name: 'openai_compat',
                type: 'openai-compat',
                baseUrl: openaiCompatBase,
                healthy: null,
                lastLatencyMs: null,
                lastCheckAt: 0,
                consecutiveFailures: 0,
                cooldownUntil: 0,
                failuresTotal: 0
            }
        };

        // Agent plans: ordered provider preferences and model lists
        // Goose has a pseudo-model 'github_copilot' (as used by server.js)
        this.agentPlans = {
            atlas: [
                // Re-ordered: goose first (fast, local, deterministic), openai_compat fallback
                { provider: 'goose' },
                { provider: 'openai_compat', models: defaultAtlasModels }
            ],
            grisha: [
                // Re-ordered: goose first (tool + local verification) then remote models
                { provider: 'goose' },
                { provider: 'openai_compat', models: [
                    'openai/gpt-4o',                    // 18 req/min - висока якість верифікації
                    'xai/grok-3',                       // 6 req/min - розумна верифікація
                    'mistral-ai/ministral-3b',          // 45 req/min - найшвидший
                    'microsoft/phi-3.5-mini-instruct',  // 38 req/min
                    'openai/gpt-4o-mini',               // 35 req/min
                    'microsoft/phi-3-mini-128k-instruct', // 35 req/min
                    'meta/meta-llama-3.1-8b-instruct', // 30 req/min
                    'mistral-ai/mistral-nemo'           // 14 req/min
                ]}
            ],
            // Tetyana is tool-enabled and designed for Goose only
            tetyana: [
                { provider: 'goose' },
                // IMPORTANT: openai_compat here is used ONLY for short text reporting (no execution)
                { provider: 'openai_compat', models: tetyanaTextModels }
            ]
        };

        // Intent-aware model preferences per agent (optional overrides)
        // When provided, preferred models will be tried first for the given intent, without round-robin
        this.agentIntentPrefs = {
            atlas: {
                smalltalk: [
                    'openai/gpt-4o',                    // Якісна для smalltalk
                    'openai/gpt-5-nano',                // Нова якісна
                    'mistral-ai/ministral-3b',          // 45 req/min - швидкий для smalltalk
                    'microsoft/phi-3.5-mini-instruct',  // 38 req/min
                    'microsoft/phi-3-mini-4k-instruct', // 40 req/min
                    'openai/gpt-4o-mini'                // 35 req/min
                ]
            },
            // For Tetyana, when intentHint === 'short_report', prioritize the configured list (up to 58 models)
            tetyana: {
                short_report: tetyanaTextModels
            }
        };

        // Rotation indices per agent/provider
        this.roundRobinIdx = {
            atlas: { openai_compat: 0 },
            grisha: { openai_compat: 0 },
            tetyana: { openai_compat: 0 }
        };

        // Start background health checks
        this._healthTimer = setInterval(() => this.checkAllProviders().catch(() => {}), this.healthIntervalMs);
        // Initial eager check (non-blocking)
        this.checkAllProviders().catch(() => {});
    }

    dispose() {
        if (this._healthTimer) clearInterval(this._healthTimer);
    }

    // Public: get ordered candidate routes for an agent
    getRoutes(agentName, options = {}) {
        const intentHint = options.intentHint || null;
        const plan = this.agentPlans[agentName] || [];
        const routes = [];
        for (const step of plan) {
            const prov = this.providers[step.provider];
            if (!prov) continue;

            // Skip if provider on cooldown
            if (prov.cooldownUntil && now() < prov.cooldownUntil) continue;

            if (step.provider === 'openai_compat') {
                const models = step.models || [];
                if (!models.length) continue;
                const prefs = this.agentIntentPrefs?.[agentName]?.[intentHint] || null;
                if (prefs && Array.isArray(prefs) && prefs.length) {
                    // Build prioritized unique list: preferred first, then remaining in defined order
                    const preferSet = new Set(prefs);
                    const prioritized = [];
                    for (const m of prefs) if (models.includes(m) && !this._isModelBlacklisted(m)) prioritized.push(m);
                    for (const m of models) if (!preferSet.has(m) && !this._isModelBlacklisted(m)) prioritized.push(m);
                    for (const m of prioritized) {
                        routes.push({ provider: 'openai_compat', baseUrl: prov.baseUrl, model: m });
                    }
                } else {
                    const rr = this.roundRobinIdx[agentName]?.openai_compat ?? 0;
                    // Filter out blacklisted models and rotate starting point for load spreading
                    const availableModels = models.filter(m => !this._isModelBlacklisted(m));
                    const blacklistedModels = models.filter(m => this._isModelBlacklisted(m));
                    
                    if (blacklistedModels.length > 0) {
                        console.log(`[MODEL_REGISTRY] Agent ${agentName}: ${blacklistedModels.length} models blacklisted: ${blacklistedModels.join(', ')}`);
                    }
                    
                    for (let i = 0; i < availableModels.length; i++) {
                        const idx = (rr + i) % availableModels.length;
                        routes.push({
                            provider: 'openai_compat',
                            baseUrl: prov.baseUrl,
                            model: availableModels[idx]
                        });
                    }
                    // Advance rotation pointer
                    if (this.roundRobinIdx[agentName] && availableModels.length > 0) {
                        this.roundRobinIdx[agentName].openai_compat = (rr + 1) % availableModels.length;
                    }
                }
            } else if (step.provider === 'goose') {
                routes.push({ provider: 'goose', baseUrl: prov.baseUrl, model: 'github_copilot' });
            }
        }
        return routes;
    }

    // Health management
    async checkAllProviders() {
        const names = Object.keys(this.providers);
        await Promise.all(names.map(n => this.checkProvider(n).catch(() => {})));
        return this.providers;
    }

    async checkProvider(name) {
        const p = this.providers[name];
        if (!p) return false;
        const start = now();
        try {
            if (p.type === 'goose') {
                // Prefer /health if available
                const url = `${p.baseUrl}/health`;
                const resp = await axios.get(url, { timeout: this.healthTimeoutMs, validateStatus: () => true });
                if (resp.status >= 200 && resp.status < 500) {
                    this._markHealthy(p, now() - start);
                    return true;
                }
                throw new Error(`goose health HTTP ${resp.status}`);
            }
            if (p.type === 'openai-compat') {
                // Try /models first
                const url = `${p.baseUrl}/models`;
                const resp = await axios.get(url, { timeout: this.healthTimeoutMs, validateStatus: () => true });
                if (resp.status >= 200 && resp.status < 500) {
                    this._markHealthy(p, now() - start);
                    return true;
                }
                // Fallback: tiny chat completion
                const ccUrl = `${p.baseUrl}/chat/completions`;
                const payload = { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 1 };
                const cc = await axios.post(ccUrl, payload, { timeout: this.healthTimeoutMs, validateStatus: () => true });
                if (cc.status >= 200 && cc.status < 500) {
                    this._markHealthy(p, now() - start);
                    return true;
                }
                throw new Error(`openai-compat health HTTP ${resp.status}/${cc.status}`);
            }
            // Unknown type -> mark healthy by default
            this._markHealthy(p, now() - start);
            return true;
        } catch (err) {
            this._markFailure(p);
            return false;
        }
    }

    reportSuccess(route, latencyMs = null) {
        const p = this.providers[route?.provider];
        if (!p) return;
        this._markHealthy(p, latencyMs);
        
        // Clear model failure count on success
        if (route?.model && this.modelFailures.has(route.model)) {
            this.modelFailures.delete(route.model);
        }
    }

    reportFailure(route, error = null) {
        const p = this.providers[route?.provider];
        if (!p) return;
        this._markFailure(p);
        
        // Track model-specific failures
        if (route?.model) {
            this._recordModelFailure(route.model, error);
        }
    }

    // Model blacklist management
    _isModelBlacklisted(modelId) {
        const failures = this.modelFailures.get(modelId);
        if (!failures) return false;
        
        // Check if still in cooldown
        if (failures.cooledUntil && now() < failures.cooledUntil) {
            return true;
        }
        
        // Clear expired cooldown
        if (failures.cooledUntil && now() >= failures.cooledUntil) {
            this.modelFailures.delete(modelId);
            return false;
        }
        
        return failures.count >= this.modelFailureThreshold;
    }

    _recordModelFailure(modelId, error = null) {
        const current = this.modelFailures.get(modelId) || { count: 0, lastFailure: 0, cooledUntil: 0 };
        current.count++;
        current.lastFailure = now();
        current.lastError = error?.message || error?.code || 'unknown';
        
        // Apply cooldown if threshold reached
        if (current.count >= this.modelFailureThreshold) {
            current.cooledUntil = now() + this.modelCooldownMs;
            console.warn(`[MODEL_REGISTRY] Model ${modelId} blacklisted for ${this.modelCooldownMs/1000}s after ${current.count} failures. Last error: ${current.lastError}`);
        }
        
        this.modelFailures.set(modelId, current);
    }

    _markHealthy(p, latencyMs) {
        p.healthy = true;
        p.lastLatencyMs = latencyMs ?? p.lastLatencyMs;
        p.lastCheckAt = now();
        p.consecutiveFailures = 0;
        p.cooldownUntil = 0;
    }

    _markFailure(p) {
        p.healthy = false;
        p.lastCheckAt = now();
        p.consecutiveFailures = (p.consecutiveFailures || 0) + 1;
    p.failuresTotal = (p.failuresTotal || 0) + 1;
        if (p.consecutiveFailures >= this.failureThreshold) {
            p.cooldownUntil = now() + this.cooldownMs;
        }
    }

    // Admin/state
    getState() {
        return {
            timestamp: new Date().toISOString(),
            providers: this.providers,
            roundRobinIdx: this.roundRobinIdx,
            agentPlans: this.agentPlans,
            settings: {
                healthTimeoutMs: this.healthTimeoutMs,
                failureThreshold: this.failureThreshold,
                cooldownMs: this.cooldownMs,
                healthIntervalMs: this.healthIntervalMs
            }
        };
    }
}

export default ModelRegistry;
