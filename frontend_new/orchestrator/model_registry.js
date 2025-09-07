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
        
        // Tetyana report fallback settings
        this.tetyanaReportMaxRetries = parseInt(process.env.TETYANA_REPORT_MAX_RETRIES || '15', 10); // Max models to try for reports
        this.tetyanaReportTimeoutMs = parseInt(process.env.TETYANA_REPORT_TIMEOUT_MS || '8000', 10); // Per-model timeout for reports

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

        // Extended list for Tetyana TTS reports - prioritize speed for summaries, with comprehensive fallback
        const defaultTetyanaModels = [
            // Speed tier 1: Ultra-fast models (40+ req/min)
            'mistral-ai/ministral-3b',              // 45 req/min - найшвидший для звітів
            'microsoft/phi-3-mini-4k-instruct',     // 40 req/min - швидкі summaries
            'mistral-ai/mistral-small-2503',        // 40 req/min - швидкі звіти
            
            // Speed tier 2: Fast models (30-39 req/min)
            'microsoft/phi-3.5-mini-instruct',      // 38 req/min
            'microsoft/phi-3-mini-128k-instruct',   // 35 req/min
            'meta/meta-llama-3.1-8b-instruct',     // 30 req/min
            'openai/gpt-4.1-mini',                  // 30 req/min
            'microsoft/phi-3-small-8k-instruct',   // 30 req/min
            
            // Speed tier 3: Medium models (20-29 req/min)
            'microsoft/phi-3-small-128k-instruct',  // 28 req/min
            'ai21-labs/ai21-jamba-1.5-mini',       // 25 req/min
            'microsoft/phi-4-mini-instruct',        // 22 req/min
            
            // Quality tier: High-quality models for important summaries (15-20 req/min)
            'openai/gpt-4o',                        // 18 req/min - висока якість
            'mistral-ai/mistral-medium-2505',       // 18 req/min
            'mistral-ai/mistral-nemo',              // 14 req/min
            'openai/gpt-4.1',                       // 12 req/min
            
            // Premium tier: Best reasoning for complex reports (6-8 req/min)
            'microsoft/phi-4',                      // 8 req/min
            'xai/grok-3',                           // 6 req/min - найкращий для складних звітів
            'mistral-ai/mistral-large-2411',        // 6 req/min
        ];

        // Load extended list for Tetyana short-report summarization
        const tetyanaTextModels = parseModels(['TETYANA_TEXT_MODELS', 'TETYANA_TEXT_MODELS_58'], defaultTetyanaModels);

        // Atlas advanced reasoning models - якість перш за все
        const defaultAtlasModels = parseModels(['ATLAS_TEXT_MODELS'], [
            // Removed: 'openai/o3' (http_error)
            'openai/gpt-4o',                        // 18 req/min - проверена висока якість
            'xai/grok-3',                           // 6 req/min - найкраще міркування
            // Removed: 'openai/gpt-5-nano' (http_error)
            'openai/gpt-4.1',                       // 12 req/min
            'mistral-ai/mistral-large-2411',        // 6 req/min
            'microsoft/phi-4'                       // 8 req/min
            // Removed: 'openai/o1-mini' (http_error)
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

    // Latency / performance tracking
    this.modelStats = new Map(); // modelId -> { latencySum, count, avg }
    this.modelLatencyThresholdMs = parseInt(process.env.MODEL_LATENCY_THRESHOLD_MS || '4000', 10); // soft reorder threshold
    this.modelHardLatencySkipMs = parseInt(process.env.MODEL_HARD_LATENCY_SKIP_MS || (this.modelLatencyThresholdMs * 2).toString(), 10); // skip threshold
    this._slowLogEmitted = new Set(); // to avoid log spam for slow skips

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
                    // Removed: 'openai/gpt-5-nano' (http_error)
                    'mistral-ai/ministral-3b',          // 45 req/min - швидкий для smalltalk
                    'microsoft/phi-3.5-mini-instruct',  // 38 req/min
                    'microsoft/phi-3-mini-4k-instruct', // 40 req/min
                    // removed gpt-4o-mini
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
                    const availableModelsBase = models.filter(m => !this._isModelBlacklisted(m));
                    const availableModels = [];
                    for (const m of availableModelsBase) {
                        if (this._isModelTooSlow(m)) {
                            if (!this._slowLogEmitted.has(m)) {
                                console.warn(`[MODEL_REGISTRY] Model ${m} skipped (avg latency > ${this.modelHardLatencySkipMs}ms)`);
                                this._slowLogEmitted.add(m);
                            }
                            continue; // hard skip
                        }
                        availableModels.push(m);
                    }
                    const blacklistedModels = models.filter(m => this._isModelBlacklisted(m));
                    
                    // Special logging for Tetyana reports to track fallback availability
                    if (agentName === 'tetyana' && intentHint === 'short_report') {
                        console.log(`[MODEL_REGISTRY] Tetyana reports: ${availableModels.length} available models, ${blacklistedModels.length} blacklisted (max_retries=${this.tetyanaReportMaxRetries})`);
                        if (availableModels.length === 0) {
                            console.error(`[MODEL_REGISTRY] CRITICAL: No models available for Tetyana reports! All ${models.length} models blacklisted.`);
                        } else if (availableModels.length < 5) {
                            console.warn(`[MODEL_REGISTRY] WARNING: Only ${availableModels.length} models available for Tetyana reports, low fallback options.`);
                        }
                    } else if (blacklistedModels.length > 0) {
                        console.log(`[MODEL_REGISTRY] Agent ${agentName}: ${blacklistedModels.length} models blacklisted: ${blacklistedModels.join(', ')}`);
                    }
                    
                    // Reorder by avg latency (fast first), but preserve rotation start
                    const withLatency = availableModels.map(m => {
                        const stat = this.modelStats.get(m);
                        return { m, avg: stat?.avg ?? 0 };
                    });
                    withLatency.sort((a, b) => (a.avg - b.avg));
                    const ordered = withLatency.map(o => o.m);
                    for (let i = 0; i < ordered.length; i++) {
                        const idx = (rr + i) % availableModels.length;
                        routes.push({
                            provider: 'openai_compat',
                            baseUrl: prov.baseUrl,
                            model: ordered[idx]
                        });
                    }
                    // Advance rotation pointer
                    if (this.roundRobinIdx[agentName] && ordered.length > 0) {
                        this.roundRobinIdx[agentName].openai_compat = (rr + 1) % ordered.length;
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
                const payload = { model: 'openai/gpt-4o', messages: [{ role: 'user', content: 'ping' }], stream: false, max_tokens: 1 };
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
        // Track latency stats per model for adaptive ordering / skipping
        if (route?.model && typeof latencyMs === 'number') {
            const st = this.modelStats.get(route.model) || { latencySum: 0, count: 0, avg: 0 };
            st.latencySum += latencyMs;
            st.count += 1;
            st.avg = st.latencySum / st.count;
            this.modelStats.set(route.model, st);
            if (st.avg > this.modelLatencyThresholdMs && !this._slowLogEmitted.has(route.model) && st.avg < this.modelHardLatencySkipMs) {
                console.warn(`[MODEL_REGISTRY] Model ${route.model} marked slow (avg ${Math.round(st.avg)}ms > ${this.modelLatencyThresholdMs}ms) — deprioritized`);
                this._slowLogEmitted.add(route.model); // single log until threshold changes / restart
            }
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

    _isModelTooSlow(modelId) {
        const st = this.modelStats.get(modelId);
        if (!st) return false;
        return st.avg > this.modelHardLatencySkipMs;
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
                healthIntervalMs: this.healthIntervalMs,
                modelLatencyThresholdMs: this.modelLatencyThresholdMs,
                modelHardLatencySkipMs: this.modelHardLatencySkipMs,
                tetyanaReportMaxRetries: this.tetyanaReportMaxRetries,
                tetyanaReportTimeoutMs: this.tetyanaReportTimeoutMs
            },
            modelStats: Object.fromEntries([...this.modelStats.entries()].map(([k,v]) => [k, { avg: Math.round(v.avg), count: v.count }]))
        };
    }
}

export default ModelRegistry;
