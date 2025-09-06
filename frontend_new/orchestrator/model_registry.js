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

        // Default compact list if 58-model env not provided (strongly recommended to set TETYANA_TEXT_MODELS or TETYANA_TEXT_MODELS_58)
        const defaultTetyanaModels = [
            'microsoft/phi-3.5-mini-instruct',
            'meta/meta-llama-3.1-8b-instruct',
            'mistral-ai/mistral-nemo',
            'openai/gpt-4o-mini',
            'qwen/qwen2.5-7b-instruct',
            'google/gemma-2-9b-it',
            'deepseek/deepseek-r1-distill-qwen-7b'
        ];

        // Load extended list for Tetyana short-report summarization
        const tetyanaTextModels = parseModels(['TETYANA_TEXT_MODELS', 'TETYANA_TEXT_MODELS_58'], defaultTetyanaModels);

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
                { provider: 'openai_compat', models: [
                    'microsoft/phi-3.5-mini-instruct',
                    'meta/meta-llama-3.1-8b-instruct',
                    'openai/gpt-4o-mini'
                ]},
                { provider: 'goose' }
            ],
            grisha: [
                { provider: 'openai_compat', models: [
                    'microsoft/phi-3.5-mini-instruct',
                    'mistral-ai/mistral-nemo',
                    'openai/gpt-4o-mini'
                ]},
                { provider: 'goose' }
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
                    'microsoft/phi-3.5-mini-instruct', // fast, conversational
                    'meta/meta-llama-3.1-8b-instruct',
                    'openai/gpt-4o-mini'
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
                    for (const m of prefs) if (models.includes(m)) prioritized.push(m);
                    for (const m of models) if (!preferSet.has(m)) prioritized.push(m);
                    for (const m of prioritized) {
                        routes.push({ provider: 'openai_compat', baseUrl: prov.baseUrl, model: m });
                    }
                } else {
                    const rr = this.roundRobinIdx[agentName]?.openai_compat ?? 0;
                    // Rotate starting point for load spreading
                    for (let i = 0; i < models.length; i++) {
                        const idx = (rr + i) % models.length;
                        routes.push({
                            provider: 'openai_compat',
                            baseUrl: prov.baseUrl,
                            model: models[idx]
                        });
                    }
                    // Advance rotation pointer
                    if (this.roundRobinIdx[agentName]) {
                        this.roundRobinIdx[agentName].openai_compat = (rr + 1) % models.length;
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
    }

    reportFailure(route) {
        const p = this.providers[route?.provider];
        if (!p) return;
        this._markFailure(p);
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
