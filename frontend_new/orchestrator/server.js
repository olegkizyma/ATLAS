/**
 * ATLAS 3-Agent System Orchestrator
 * Manages communication between Atlas, Tetiana, and Grisha agents
 * Integrates with TTS system for real-time dialogue
 */
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import path from 'path';
import os from 'os';
import ModelRegistry from './model_registry.js';
import { PHASE, initSession, startActionablePipeline, startProbePipeline, clearProbe, markNeedsMore, clearPipeline, tagResponse, executionMode, shouldImmediateExecute } from './pipeline.js';
import { initMemory, remember, recall, summarizeRecent, summarizeRanked, rememberSafe, summarizeForPrompt, memoryHealth, semanticContext, startMemoryMaintenance } from './agent_memory.js';
import gooseAdapter, { runExecution, extractEvidence } from './goose_adapter.js';
import { IntentCache } from './intent_cache.js';

// In-memory pipeline metrics (ephemeral – resets on orchestrator restart)
const PIPELINE_METRICS = {
    messagesTotal: 0,            // all /chat user messages processed
    actionableSessions: 0,       // sessions classified as actionable (pipelines started)
    immediateExecutions: 0,      // executions performed inline (immediate mode)
    stagedPipelines: 0,          // pipelines created that will require /chat/continue
    stagedExecutions: 0,         // executions performed via /chat/continue
    followups: 0,                // follow-up (GRISHA_FOLLOWUP) messages emitted
    verdicts: 0,                 // verdict messages emitted
    verificationIterations: 0,   // cumulative verification iterations (all loops)
    verificationConfidenceSum: 0,// sum of final confidence values (for avg)
    mockExecutions: 0,           // fallback simulated executions (if any)
    clarifications: 0,           // clarification escalations (Atlas asking for Stage 0 data)
    planningPromotions: 0,       // planning -> actionable promotions
    planningStallClarifications: 0, // clarifications due to repeated planning loop
    duplicatesSuppressed: 0,     // clientMessageId based duplicate user messages ignored
    // Probe metrics
    probesStarted: 0,            // initiated internal probe cycles
    probesAdvanced: 0,           // probes that led to ADVANCE (self-sufficient)
    probesClarified: 0,          // probes that still required user clarification
    probeAttempts: 0,            // total probe attempts (including retries)
    probeLatencyMs: 0,           // cumulative latency for completed probe cycles
    probeCycles: 0,              // number of probe cycles measured (for avg)
    memoryFactsWritten: 0,
    memoryFactsPruned: 0,
    memoryContextInjections: 0,
    memoryContextTokens: 0,
    circuitBreaker: {            // circuit breaker state and metrics
        failuresTotal: 0,        // total failure count since start
        cooldownRemaining: 0,    // milliseconds until circuit closes
        isOpen: false,           // current circuit state
        consecutiveFailures: 0,  // consecutive failures without success
        lastFailureTime: 0       // timestamp of last failure
    }
};
// Expose globally for memory module side-effects
globalThis.PIPELINE_METRICS = PIPELINE_METRICS;

const app = express();
initMemory();
startMemoryMaintenance();
const PORT = process.env.ORCH_PORT || 5101;
const GRISHA_CONFIDENCE_THRESHOLD = Math.max(0, Math.min(1, parseFloat(process.env.GRISHA_CONFIDENCE_THRESHOLD || '0.8')));
const GRISHA_MAX_VERIFY_ITER = Math.max(1, parseInt(process.env.GRISHA_MAX_VERIFY_ITER || '3', 10));
// Fast-lane timeout for user silence before autonomous clarification auto-fill (was 120s default -> now configurable, test=30s)
// Clarification auto-fill silence threshold (ms) configurable via env ATLAS_CLAR_AUTOFILL_MS
const CLARIFICATION_AUTOFILL_SILENCE_MS = parseInt(process.env.ATLAS_CLAR_AUTOFILL_MS || '30000', 10);

// Deterministic fast-lane patterns (very low risk). Pure math + simple file write directive.
const FAST_LANE_PATTERNS = [
    { type: 'math', re: /(sqrt|корінь)\s*(?:з|of)?\s*([0-9]+)\b/i },
    { type: 'arith', re: /^\s*([0-9]+)\s*([+\-*\/])\s*([0-9]+)\s*$/ }
];

function evaluateDeterministicExpression(text) {
    for (const p of FAST_LANE_PATTERNS) {
        const m = text.match(p.re);
        if (m && p.type === 'math') {
            const n = parseInt(m[2],10);
            if (!isNaN(n)) return { kind: 'sqrt', input: n, result: Math.sqrt(n) };
        }
        if (m && p.type === 'arith') {
            const a = parseFloat(m[1]); const op = m[2]; const b = parseFloat(m[3]);
            let r; if(op==='+' ) r=a+b; else if(op==='-') r=a-b; else if(op==='*') r=a*b; else if(op==='/' && b!==0) r=a/b; else continue;
            return { kind: 'arith', input: `${a}${op}${b}`, result: r };
        }
    }
    return null;
}

function attemptFastLane(userMessage) {
    const deterministic = evaluateDeterministicExpression(userMessage);
    if (deterministic) {
        return {
            content: `[ТЕТЯНА] РЕЗЮМЕ: Виконано просте обчислення.
КРОКИ: 1) Обчислено ${deterministic.kind==='sqrt'?`корінь з ${deterministic.input}`:deterministic.input}.
РЕЗУЛЬТАТИ: ${deterministic.result}
ДОКАЗИ: результат обчислення є детермінованим.
ПЕРЕВІРКА: повторний підрахунок внутрішнім калькулятором.
СТАТУС: Done`,
            agent: 'tetyana', provider: 'fast_lane', model: 'deterministic_math'
        };
    }
    return null;
}

// NOTE: Older lightweight scheduleClarificationAutoFill implementation removed (duplicate name) —
// consolidated with advanced variant later in file that emits richer auto-clarification messages.

// Intent router integration (feature flag)
const INTENT_ROUTER_ENABLED = String(process.env.INTENT_ROUTER || '0') === '1';
const INTENT_ROUTER_URL = process.env.INTENT_ROUTER_URL || 'http://localhost:5001/api/intent';
const intentCache = new IntentCache(64, 300000); // 64 items, 5min TTL

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Secret-Key']
}));
app.use(express.json({ limit: '10mb' }));

// OpenAI-compatible fallback API base (used for Atlas/Grisha only)
const FALLBACK_API_BASE = (process.env.FALLBACK_API_BASE || 'http://127.0.0.1:3010/v1').replace(/\/$/, '');
// Allow disabling or fast-skip of openai_compat provider to avoid long stalls when service (port 3010) is absent
let OPENAI_COMPAT_DISABLED = (process.env.DISABLE_OPENAI_COMPAT === '1') || (process.env.NO_OPENAI_COMPAT === '1') || (process.env.FAST_NO_OPENAI === '1');
let openAICompatDown = false;      // true when last probe/call failed
let openAICompatRecovered = false; // becomes true if service comes back after being down

// Periodic fast probe (circuit breaker with auto-recovery)
(async () => {
    if (OPENAI_COMPAT_DISABLED) return;
    const probe = async () => {
        try {
            await axios.get(FALLBACK_API_BASE + '/models', { timeout: 800 });
            if (openAICompatDown) {
                openAICompatDown = false;
                openAICompatRecovered = true;
                console.log('[openai_compat] service recovered; re-enabled');
            }
        } catch (e) {
            if (!openAICompatDown) console.warn('[openai_compat] probe failed; soft-disabling');
            openAICompatDown = true;
        }
    };
    await probe();
    setInterval(() => { if (!OPENAI_COMPAT_DISABLED) probe(); }, 30000).unref?.();
})();

function estimateTokens(str) {
    if (!str) return 0;
    // Rough heuristic: 4 chars ≈ 1 token
    return Math.ceil(str.length / 4);
}

function dynamicLLMTimeout(model, message) {
    // If disabled or down, return ultra-short timeout (fast-fail)
    if (OPENAI_COMPAT_DISABLED || openAICompatDown) return 250; // 250ms guard
    const baseMs = parseInt(process.env.LLM_BASE_TIMEOUT_MS || '8000', 10); // 8s base
    const perTokMs = parseFloat(process.env.LLM_PER_TOKEN_TIMEOUT_MS || '18'); // 18ms per token heuristic
    const maxMs = parseInt(process.env.LLM_MAX_TIMEOUT_MS || process.env.OPENAI_COMPAT_TIMEOUT_MS || '60000', 10);
    const tokens = estimateTokens(message);
    let est = baseMs + tokens * perTokMs;
    const lower = model?.toLowerCase() || '';
    if (/70b|gpt-5|deepseek-v3/.test(lower)) est *= 1.6;
    else if (/llama-3\.3|gemma-2|deepseek-r1/.test(lower)) est *= 1.25;
    if (est > maxMs) est = maxMs;
    if (est < baseMs) est = baseMs;
    return Math.ceil(est);
}

async function callOpenAICompatChat(baseUrl, model, userMessage) {
    if (OPENAI_COMPAT_DISABLED || openAICompatDown) return null; // soft-disable
    const url = `${baseUrl}/chat/completions`;
    const payload = { model, messages: [ { role: 'user', content: userMessage } ], stream: false };
    const apiKey = process.env.OPENAI_COMPAT_API_KEY || process.env.FALLBACK_API_KEY || '';
    const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'X-API-Key': apiKey } : {}) };
    const timeoutMs = dynamicLLMTimeout(model, userMessage);
    try {
        const resp = await axios.post(url, payload, { headers, timeout: timeoutMs });
        if (resp.status !== 200) throw new Error(`OpenAI-compat HTTP ${resp.status}`);
        const text = resp.data?.choices?.[0]?.message?.content;
        return (typeof text === 'string' && text.trim()) ? text.trim() : null;
    } catch (e) {
        openAICompatDown = true; // trip circuit breaker
        if (!OPENAI_COMPAT_DISABLED) console.warn('[openai_compat] call failed, disabling further attempts this run:', e.message || e);
        return null;
    }
}

async function callOpenAICompatChatWithTimeout(baseUrl, model, userMessage, timeoutMs = 1500) {
    if (OPENAI_COMPAT_DISABLED || openAICompatDown) return null;
    const url = `${baseUrl}/chat/completions`;
    const payload = { model, messages: [ { role: 'user', content: userMessage } ], stream: false };
    const apiKey = process.env.OPENAI_COMPAT_API_KEY || process.env.FALLBACK_API_KEY || '';
    const headers = { 'Content-Type': 'application/json', ...(apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'X-API-Key': apiKey } : {}) };
    const dyn = Math.min(timeoutMs, dynamicLLMTimeout(model, userMessage));
    try {
        const resp = await axios.post(url, payload, { headers, timeout: dyn });
        if (resp.status !== 200) throw new Error(`OpenAI-compat HTTP ${resp.status}`);
        const text = resp.data?.choices?.[0]?.message?.content;
        return (typeof text === 'string' && text.trim()) ? text.trim() : null;
    } catch (e) {
        openAICompatDown = true;
        return null;
    }
}

// Diagnostics endpoint for openai_compat status
app.get('/diagnostics/openai_compat_status', (req, res) => {
    res.json({
        disabled: OPENAI_COMPAT_DISABLED,
        down: openAICompatDown,
        recovered_once: openAICompatRecovered,
        base: FALLBACK_API_BASE
    });
});

// Dynamic model/provider registry
const registry = new ModelRegistry();

// Agent configurations
const AGENTS = {
    atlas: {
        role: 'strategist',
        signature: '[ATLAS]',
        color: '#00ff00',
        voice: 'dmytro',
        priority: 1
    },
    tetyana: {
        role: 'executor', 
        signature: '[ТЕТЯНА]',
        color: '#00ffff',
        voice: 'tetiana',
        priority: 2
    },
    grisha: {
        role: 'validator',
        signature: '[ГРИША]', 
        color: '#ffff00',
    voice: 'mykyta',
        priority: 3
    }
};

// Probe prompts configuration (centralized for fine-tuning)
const PROBE_PROMPTS = {
    tetyanaProbe: ({ userMessage, atlasPlan, grishaShortage }) => [
        'Ти — Тетяна. Виконай МІНІМАЛЬНИЙ пробний крок щоб здобути бракуючий артефакт.',
        'Лише 1-2 дії. Не запускай повний план. Не пояснюй зайвого.',
        'Формат строго:\nКРОКИ:\n1) ...\nАРТЕФАКТИ: (коротко)',
        `Завдання користувача: ${userMessage}`,
        `Поточний план Atlas: ${atlasPlan}`,
        `Бракує (з Гриші): ${grishaShortage}`
    ].join('\n'),
    grishaReview: (probeContent) => [
        'Ти — Гриша. Оціни пробу. Якщо вистачає даних для продовження без користувача — начни з FEASIBLE, інакше INFEASIBLE.',
        'Після ключового слова дай коротко що отримано / чого бракує.',
        `Пробний звіт: ${probeContent}`
    ].join('\n'),
    atlasFeasibility: (probeContent, reviewContent) => [
        'Ти — Atlas. На основі проби і ревʼю напиши: ADVANCE або CLARIFY (первое слово).',
        'Після слова — дуже короткий коментар.',
        `Проба: ${probeContent}`,
        `Ревʼю: ${reviewContent}`
    ].join('\n'),
    atlasClarificationFallback: () => [
        'Ти — Atlas. Сформуй короткий структурований ЕТАП 0: які дані потрібні щоб продовжити.',
        'Список пунктів, без води. Заверши: «Надайте ці дані однією відповіддю — після цього я згенерую план виконання.»'
    ].join('\n')
};

// Session state management
const sessions = new Map();
let messageCounter = 0;

// Helper functions
const generateMessageId = () => `msg_${Date.now()}_${++messageCounter}`;

// Visual Monitoring Integration for Grisha
const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'http://127.0.0.1:5001';

async function startGrishaVisualMonitoring(sessionId, taskDescription) {
    try {
        const response = await axios.post(`${FRONTEND_BASE_URL}/api/grisha/start-monitoring`, {
            session_id: sessionId,
            task_description: taskDescription
        }, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.data.success) {
            console.log(`[GRISHA] Visual monitoring started for session ${sessionId}`);
            return response.data;
        } else {
            console.warn(`[GRISHA] Failed to start visual monitoring: ${response.data.error}`);
            return null;
        }
    } catch (error) {
        console.warn(`[GRISHA] Visual monitoring start failed: ${error.message}`);
        return null;
    }
}

async function stopGrishaVisualMonitoring() {
    try {
        const response = await axios.post(`${FRONTEND_BASE_URL}/api/grisha/stop-monitoring`, {}, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.data.success) {
            console.log(`[GRISHA] Visual monitoring stopped for session ${response.data.session_id}`);
            return response.data;
        } else {
            console.warn(`[GRISHA] Failed to stop visual monitoring: ${response.data.error}`);
            return null;
        }
    } catch (error) {
        console.warn(`[GRISHA] Visual monitoring stop failed: ${error.message}`);
        return null;
    }
}

async function getGrishaVisualEvidence() {
    try {
        const response = await axios.get(`${FRONTEND_BASE_URL}/api/grisha/visual-evidence`, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (response.data.success) {
            return response.data.visual_evidence || [];
        } else {
            console.warn(`[GRISHA] Failed to get visual evidence: ${response.data.error}`);
            return [];
        }
    } catch (error) {
        console.warn(`[GRISHA] Visual evidence retrieval failed: ${error.message}`);
        return [];
    }
}

const logMessage = (level, message) => {
    const now = new Date();
    const utcTime = now.toISOString();
    const localOffset = now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(localOffset) / 60);
    const offsetMinutes = Math.abs(localOffset) % 60;
    const offsetSign = localOffset <= 0 ? '+' : '-';
    const offsetStr = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
    
    console.log(`[${utcTime}${offsetStr}] [${level.toUpperCase()}] ${message}`);
};

function logProbe(message) {
    const now = new Date();
    const utcTime = now.toISOString();
    const localOffset = now.getTimezoneOffset();
    const offsetHours = Math.floor(Math.abs(localOffset) / 60);
    const offsetMinutes = Math.abs(localOffset) % 60;
    const offsetSign = localOffset <= 0 ? '+' : '-';
    const offsetStr = `${offsetSign}${offsetHours.toString().padStart(2, '0')}:${offsetMinutes.toString().padStart(2, '0')}`;
    
    console.log(`[${utcTime}${offsetStr}] [PROBE] ${message}`);
}

// Shared memory propagation: ensure Atlas & Grisha both remember relevant dialogue involving Tetiana or mutual addressing
function recordSharedMemory(agent, content, phase) {
    try {
        if (!content) return;
        const ts = Date.now();
        const snippet = String(content).slice(0, 360);
        // When Tetiana speaks -> both Atlas & Grisha remember her output (as execution artifact)
        if (agent === 'tetyana') {
            remember('atlas', `tetyana_exec_${ts}`, snippet);
            remember('grisha', `tetyana_exec_${ts}`, snippet);
            return;
        }
        // When Atlas produces plan that will guide Grisha (atlas_plan phase)
        if (agent === 'atlas' && phase === PHASE.ATLAS_PLAN) {
            // Already stored for atlas earlier; add mirror for grisha
            remember('grisha', `atlas_plan_${ts}`, snippet);
        }
        // When Grisha precheck or follow-up instructs Tetiana -> mirror for atlas
        if (agent === 'grisha' && (phase === PHASE.GRISHA_PRECHECK || phase === PHASE.GRISHA_FOLLOWUP)) {
            remember('atlas', `grisha_req_${ts}`, snippet);
        }
        // Probe specific: share probe review & feasibility across both
        if (phase === PHASE.GRISHA_PROBE_REVIEW) {
            rememberSafe('atlas', `probe_review_${ts}`, snippet);
        }
        if (phase === PHASE.ATLAS_FEASIBILITY) {
            remember('grisha', `feasibility_${ts}`, snippet);
        }
    } catch (e) {
        // silent
    }
}

// ---------------- Prometheus Metrics Export ----------------
function buildPrometheusMetrics() {
    const m = PIPELINE_METRICS;
    const lines = [];
    const gauge = (name, help, value) => {
        lines.push(`# HELP ${name} ${help}`);
        lines.push(`# TYPE ${name} gauge`);
        lines.push(`${name} ${value}`);
    };
    const avgVerificationConfidence = m.verificationIterations ? (m.verificationConfidenceSum / m.verificationIterations) : 0;
    const avgProbeLatency = m.probeCycles ? (m.probeLatencyMs / m.probeCycles) : 0;
    gauge('atlas_messages_total','Total user messages processed', m.messagesTotal);
    gauge('atlas_actionable_sessions','Sessions classified actionable', m.actionableSessions);
    gauge('atlas_immediate_executions','Immediate executions performed', m.immediateExecutions);
    gauge('atlas_staged_pipelines','Pipelines staged', m.stagedPipelines);
    gauge('atlas_followups_total','Follow-up messages emitted', m.followups);
    gauge('atlas_verdicts_total','Verdicts emitted', m.verdicts);
    gauge('atlas_verification_iterations_total','Total verification iterations', m.verificationIterations);
    gauge('atlas_avg_verification_confidence','Average verification confidence', avgVerificationConfidence.toFixed(4));
    gauge('atlas_clarifications_total','Clarification escalations', m.clarifications);
    gauge('atlas_planning_stall_clarifications_total','Planning stall clarifications', m.planningStallClarifications);
    gauge('atlas_probes_started_total','Probes started', m.probesStarted);
    gauge('atlas_probes_advanced_total','Probes advanced', m.probesAdvanced);
    gauge('atlas_probes_clarified_total','Probes clarified', m.probesClarified);
    gauge('atlas_probe_attempts_total','Probe attempts', m.probeAttempts);
    gauge('atlas_probe_avg_latency_ms','Average probe cycle latency ms', avgProbeLatency.toFixed(2));
    gauge('atlas_memory_facts_written_total','Facts written to memory', m.memoryFactsWritten);
    gauge('atlas_memory_facts_pruned_total','Facts pruned from memory', m.memoryFactsPruned);
    gauge('atlas_memory_context_injections_total','Memory context blocks injected into prompts', m.memoryContextInjections||0);
    gauge('atlas_memory_context_tokens_total','Estimated tokens injected from memory', m.memoryContextTokens||0);
    gauge('atlas_duplicates_suppressed_total','Duplicate user messages suppressed', m.duplicatesSuppressed||0);
    // circuit breaker
    gauge('atlas_cb_failures_total','Circuit breaker total failures', m.circuitBreaker.failuresTotal);
    gauge('atlas_cb_consecutive_failures','Circuit breaker consecutive failures', m.circuitBreaker.consecutiveFailures);
    gauge('atlas_cb_open','Circuit breaker open state (1=open)', m.circuitBreaker.isOpen ? 1 : 0);
    return lines.join('\n') + '\n';
}

app.get('/metrics/prometheus', (req, res) => {
    try {
        res.setHeader('Content-Type','text/plain; version=0.0.4');
        res.send(buildPrometheusMetrics());
    } catch (e) {
        res.status(500).send(`# error ${e.message}`);
    }
});

// Circuit breaker management (Phase 2 completion)
const CIRCUIT_BREAKER_THRESHOLD = 3; // failures before opening
const CIRCUIT_BREAKER_COOLDOWN = 30000; // 30 seconds

function recordCircuitBreakerFailure() {
    PIPELINE_METRICS.circuitBreaker.failuresTotal++;
    PIPELINE_METRICS.circuitBreaker.consecutiveFailures++;
    PIPELINE_METRICS.circuitBreaker.lastFailureTime = Date.now();
    
    if (PIPELINE_METRICS.circuitBreaker.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        PIPELINE_METRICS.circuitBreaker.isOpen = true;
        PIPELINE_METRICS.circuitBreaker.cooldownRemaining = CIRCUIT_BREAKER_COOLDOWN;
        logMessage('warn', `[CIRCUIT_BREAKER] Opened after ${CIRCUIT_BREAKER_THRESHOLD} consecutive failures`);
    }
}

function recordCircuitBreakerSuccess() {
    PIPELINE_METRICS.circuitBreaker.consecutiveFailures = 0;
    PIPELINE_METRICS.circuitBreaker.isOpen = false;
    PIPELINE_METRICS.circuitBreaker.cooldownRemaining = 0;
}

function updateCircuitBreakerCooldown() {
    if (PIPELINE_METRICS.circuitBreaker.isOpen) {
        const elapsed = Date.now() - PIPELINE_METRICS.circuitBreaker.lastFailureTime;
        PIPELINE_METRICS.circuitBreaker.cooldownRemaining = Math.max(0, CIRCUIT_BREAKER_COOLDOWN - elapsed);
        
        if (PIPELINE_METRICS.circuitBreaker.cooldownRemaining === 0) {
            PIPELINE_METRICS.circuitBreaker.isOpen = false;
            PIPELINE_METRICS.circuitBreaker.consecutiveFailures = 0;
            logMessage('info', '[CIRCUIT_BREAKER] Closed after cooldown period');
        }
    }
}

// Missing helper caused ReferenceError -> 500 responses
function isCircuitBreakerOpen() {
    // Ensure cooldown timers are updated before reporting state
    updateCircuitBreakerCooldown();
    return PIPELINE_METRICS.circuitBreaker.isOpen === true;
}

// Tetyana structured report helpers
function tetianaSystemInstruction({ enableTools } = { enableTools: false }) {
    const base = [
        'Ти — Тетяна, виконавиця. Відповідай СТИСЛО та ЧІТКО, лише факти і результати.',
        'ЗАВЖДИ ПОВЕРТАЙ структурований звіт за шаблоном нижче українською.',
        '',
        'Формат звіту:',
        '1) РЕЗЮМЕ (1-2 речення): коротко що зроблено і статус.',
        '2) КРОКИ: нумерований список виконаних кроків.',
        '3) РЕЗУЛЬТАТИ: ключові результати з конкретикою (шляхи файлів, команди, посилання).',
        '4) ДОКАЗИ: мапа criterion -> evidence (мінімум 2 критерії) у вигляді списку.',
        '5) ПЕРЕВІРКА: як ти перевірила результат (що саме і яким способом).',
        '6) СТАТУС: Done | Blocked (з причиною) | Needs Clarification (з конкретним питанням).',
        '',
        'Відповідь починай з підпису [ТЕТЯНА]. Уникай розлогих міркувань.'
    ];
    if (enableTools) {
        base.push('', 'Тобі дозволено викликати інструменти та виконувати дії якщо це пришвидшує результат.');
    }
    return base.join('\n');
}

// Intelligent subtype classification (no hard-coded language rules inside code)
// Strategy:
// 1) Optional LLM classification (if ACTIONABLE_SUBTYPE_LLM=1) -> one token from allowed list
// 2) Configurable pattern rules via ACTIONABLE_SUBTYPE_RULES env var (JSON), e.g.:
//    {
//      "gui_app": ["калькулятор", "calculator", "open calc"],
//      "computation": ["sqrt", "обчисли"],
//      "file_op": ["створи файл", "txt", "folder"]
//    }
// 3) Fallback: 'generic'
// Results cached in-memory to avoid repeated LLM calls.
const ACTIONABLE_SUBTYPE_LLM = String(process.env.ACTIONABLE_SUBTYPE_LLM || '1') === '1';
const SUBTYPE_LABELS = ['gui_app','computation','file_op','generic'];
let SUBTYPE_RULES = {};
try {
    if (process.env.ACTIONABLE_SUBTYPE_RULES) {
        const parsed = JSON.parse(process.env.ACTIONABLE_SUBTYPE_RULES);
        if (parsed && typeof parsed === 'object') SUBTYPE_RULES = parsed;
    }
} catch (e) { console.warn('[SUBTYPE_RULES] Failed to parse ACTIONABLE_SUBTYPE_RULES:', e.message); }

// Precompile regexes from rules for faster evaluation
const SUBTYPE_RULES_REGEX = Object.fromEntries(
    Object.entries(SUBTYPE_RULES).map(([k, arr]) => {
        if (!Array.isArray(arr) || !arr.length) return [k, null];
        const escaped = arr.map(s => String(s).trim()).filter(Boolean).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        if (!escaped.length) return [k, null];
        return [k, new RegExp(`(${escaped.join('|')})`, 'i')];
    })
);

const subtypeCache = new Map(); // key: text -> subtype

async function classifyActionableSubtypeSmart(t, atlasCtx='') {
    const text = (t || '').trim();
    if (!text) return 'generic';
    const norm = text.toLowerCase();
    const cacheHit = subtypeCache.get(norm);
    if (cacheHit) return cacheHit;

    // 1) LLM classification (fast timeout) if enabled
    if (ACTIONABLE_SUBTYPE_LLM) {
        try {
            const routes = (registry.getRoutes('atlas') || []).filter(r => r.provider === 'openai_compat');
            if (routes.length) {
                const prompt = [
                    'Класифікуй підтип задачі (лише одне слово) серед: gui_app | computation | file_op | generic.',
                    'gui_app: запуск або взаємодія з GUI / додатком / програмою користувача.',
                    'computation: математичне обчислення / формула / розрахунок.',
                    'file_op: створення/зміна/читання файлів чи папок.',
                    'generic: інше або невідомо.',
                    '',
                    `Запит користувача: ${text.slice(0, 800)}`,
                    atlasCtx ? `Контекст Atlas: ${String(atlasCtx).slice(0,400)}` : '' ,
                    '',
                    'Відповідь: (тільки один токен без пояснень)'
                ].join('\n');
                for (const route of routes) {
                    try {
                        const out = await callOpenAICompatChatWithTimeout(route.baseUrl || FALLBACK_API_BASE, route.model, prompt, 1200);
                        if (out) {
                            const token = out.trim().toLowerCase();
                            if (SUBTYPE_LABELS.includes(token)) {
                                subtypeCache.set(norm, token);
                                return token;
                            }
                            // Try to salvage token inside text
                            const inner = token.split(/\s|\W/).find(x => SUBTYPE_LABELS.includes(x));
                            if (inner) {
                                subtypeCache.set(norm, inner);
                                return inner;
                            }
                        }
                    } catch (_) { /* ignore individual model failure */ }
                }
            }
        } catch (e) { console.warn('[SUBTYPE_LLM] classification failed:', e.message); }
    }

    // 2) Pattern rules (configurable)
    for (const label of SUBTYPE_LABELS) {
        const re = SUBTYPE_RULES_REGEX[label];
        if (re && re.test(text)) {
            subtypeCache.set(norm, label);
            return label;
        }
    }

    // 3) Default
    subtypeCache.set(norm, 'generic');
    return 'generic';
}

// Agent dialogue system
class AgentDialogueManager {
    constructor() {
        this.activeDiscussion = null;
        this.participantStances = new Map();
        this.userAuthority = false;
    }

    startDiscussion(topic, participants) {
        this.activeDiscussion = {
            id: generateMessageId(),
            topic,
            participants,
            startTime: Date.now(),
            messages: []
        };
        this.participantStances.clear();
        this.userAuthority = false;
        logMessage('info', `Started discussion: ${topic}`);
    }

    addStance(agent, stance) {
        this.participantStances.set(agent, stance);
        if (this.activeDiscussion) {
            this.activeDiscussion.messages.push({
                agent,
                type: 'stance',
                content: stance,
                timestamp: Date.now()
            });
        }
    }

    checkConsensus() {
        if (this.participantStances.size < 2) return false;
        const stances = Array.from(this.participantStances.values());
        // Simple consensus check - could be enhanced with NLP
        return stances.every(stance => stance.includes('погоджуюся') || stance.includes('згоден'));
    }

    requiresUserCommand() {
        return this.activeDiscussion && !this.userAuthority && !this.checkConsensus();
    }

    setUserAuthority(hasAuthority) {
        this.userAuthority = hasAuthority;
        logMessage('info', `User authority set to: ${hasAuthority}`);
    }
}

const dialogueManager = new AgentDialogueManager();

// Strict TTS gating (optional): if enabled, after generating Atlas response the server will pause
// further agent processing until the client notifies that TTS playback finished.
// Enable by setting env STRICT_TTS=1. Extension to later phases (Grisha, Tetyana) can reuse same pattern.
const STRICT_TTS = String(process.env.STRICT_TTS || '0') === '1';

// Generic TTS gating helper
function applyTtsGate(session, phaseName) {
    if (!STRICT_TTS) return false;
    session.ttsGate = session.ttsGate || {};
    const doneKey = `${phaseName}Done`;
    if (session.ttsGate[doneKey]) return false;
    session.ttsGate.pendingPhase = phaseName;
    if (phaseName === 'atlas_plan') session.ttsGate.atlasDone = session.ttsGate.atlasDone || false;
    return true;
}

// -----------------------------
// Intent LRU cache (Phase 2 optional /intent endpoint)
// Intent cache replaced with IntentCache class

async function classifyIntentWithRouter(text, atlasContext) {
    // If external INTENT_ROUTER enabled, try it; otherwise fallback to smart classifier
    if (INTENT_ROUTER_ENABLED) {
        try {
            const resp = await axios.post(INTENT_ROUTER_URL, { 
                text, 
                atlas: atlasContext 
            }, { 
                timeout: 1200, 
                validateStatus: () => true 
            });
            
            if (resp.status === 200 && resp.data) {
                const intent = String(resp.data?.intent || '').toLowerCase();
                const reply = String(resp.data?.reply || '').trim();
                
                if (['actionable','planning','qa','smalltalk','chat','task'].includes(intent)) {
                    return { intent, reply };
                }
            }
        } catch (err) {
            console.warn('[INTENT_ROUTER] Error calling external router:', err.message);
        }
    }
    
    // Fallback to smart classifier
    const intent = await classifyIntentSmart(text, atlasContext || '');
    return { intent, reply: '' };
}

async function getIntentCached(text, atlasContext) {
    const message = text.trim();
    const cached = intentCache.get(message);
    if (cached) return { intent: cached.intent, reply: cached.reply, cached: true };
    
    const result = await classifyIntentWithRouter(message, atlasContext);
    intentCache.set(message, result.intent, result.reply || '');
    return { intent: result.intent, reply: result.reply, cached: false };
}

// Session status endpoint for ACK mode
app.get('/session/:sessionId/status', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = sessions.get(sessionId);
        
        if (!session) {
            return res.json({
                sessionId,
                status: 'not_found',
                message: 'Session not found'
            });
        }
        
        let status = 'idle';
        let message = 'Session is idle';
        
        if (session.awaitingClarification) {
            status = 'awaiting_clarification';
            message = 'Waiting for user clarification';
        } else if (session.pipeline) {
            status = 'processing';
            message = `Pipeline active: ${session.pipeline.type} stage ${session.pipeline.stage || 'unknown'}`;
        } else if (session.ttsGate?.pendingPhase) {
            status = 'tts_pending';
            message = `Waiting for TTS completion: ${session.ttsGate.pendingPhase}`;
        } else if (session.nextAction) {
            status = 'next_action_pending';
            message = `Next action: ${session.nextAction}`;
        }
        
        res.json({
            sessionId,
            status,
            message,
            lastInteraction: session.lastInteraction,
            currentAgent: session.currentAgent,
            historyLength: session.history?.length || 0,
            metadata: {
                intent: session.intent,
                awaitingClarification: !!session.awaitingClarification,
                hasPipeline: !!session.pipeline,
                hasNextAction: !!session.nextAction
            }
        });
    } catch (error) {
        res.status(500).json({
            sessionId: req.params.sessionId,
            status: 'error',
            message: error.message
        });
    }
});

// Session status endpoint for ACK mode
app.get('/session/:sessionId/status', (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = sessions.get(sessionId);
        
        if (!session) {
            return res.json({
                sessionId,
                status: 'not_found',
                ready: false,
                error: 'Session not found'
            });
        }
        
        const now = Date.now();
        const lastActivity = session.lastInteraction || session.lastActivity || 0;
        const isStale = (now - lastActivity) > 300000; // 5 minutes
        
        // Determine processing status
        let status = 'idle';
        let ready = true;
        let response = null;
        
        if (session.awaitingClarification) {
            status = 'awaiting_clarification';
            ready = true;
        } else if (session.pipeline) {
            status = 'processing';
            ready = false;
        } else if (session.ttsGate && session.ttsGate.pendingPhase) {
            status = 'tts_pending';
            ready = false;
        } else if (isStale) {
            status = 'stale';
            ready = true;
        }
        
        // If there's a recent response, include it
        if (session.history && session.history.length > 0) {
            const lastMsg = session.history[session.history.length - 1];
            if (lastMsg.role === 'assistant' && (now - (lastMsg.timestamp || 0)) < 30000) {
                response = [lastMsg];
                ready = true;
                status = 'completed';
            }
        }
        
        res.json({
            sessionId,
            status,
            ready,
            response,
            timing: {
                lastActivity,
                ageMs: now - lastActivity
            },
            session: {
                currentAgent: session.currentAgent,
                awaitingClarification: !!session.awaitingClarification,
                pipelineActive: !!session.pipeline
            }
        });
        
    } catch (error) {
        res.status(500).json({
            sessionId: req.params.sessionId,
            status: 'error',
            ready: false,
            error: error.message
        });
    }
});

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/agents', (req, res) => {
    res.json(AGENTS);
});

// Memory inspection endpoint (read-only)
app.get('/memory/:agent', (req, res) => {
    try {
        const { agent } = req.params;
        if (!agent || !['atlas','grisha','tetyana'].includes(agent)) return res.status(400).json({ error: 'invalid_agent' });
        const limit = Math.min(parseInt(req.query.limit||'30',10), 200);
        const pattern = req.query.pattern ? String(req.query.pattern) : null;
        const rows = recall(agent, pattern, limit);
        res.json({ agent, count: rows.length, rows });
    } catch (e) {
        res.status(500).json({ error: 'memory_failed', details: e.message });
    }
});

// Safe remember with naive deduplication (skip if same value for same key wrote very recently)
const __recentMemoryCache = new Map(); // key -> {v, ts}
// rememberSafe now provided by agent_memory.js (hash + recency dedup)

// Lightweight intent classification endpoint
app.all('/intent', async (req, res) => {
    try {
        const text = (req.method === 'GET') ? (req.query.text || '') : (req.body?.text || req.body?.message || '');
        if (!text || !String(text).trim()) {
            return res.status(400).json({ error: 'text is required' });
        }
        const atlasCtx = req.body?.atlas || '';
        const { intent, cached } = await getIntentCached(String(text), String(atlasCtx));
        return res.json({ success: true, intent, cached, cacheSize: intentCache.size });
    } catch (e) {
        return res.status(500).json({ error: 'intent_failed', details: e.message });
    }
});

// Memory health endpoint
app.get('/memory', (req, res) => {
    try { return res.json(memoryHealth()); } catch (e) { return res.status(500).json({ error:'memory_health_failed', details:e.message }); }
});

// Providers/admin endpoints
app.get('/providers/state', (req, res) => {
    try {
        return res.json(registry.getState());
    } catch (e) {
        return res.status(500).json({ error: 'failed to get state', details: e.message });
    }
});

app.post('/providers/check', async (req, res) => {
    try {
        await registry.checkAllProviders();
        return res.json(registry.getState());
    } catch (e) {
        return res.status(500).json({ error: 'failed to run health checks', details: e.message });
    }
});

// Pipeline metrics endpoint (Phase 2 completion)
app.get('/metrics/pipeline', (req, res) => {
    try {
        const includeProviders = req.query.providers === 'true';

        // Derived metrics (keep backwards compatibility + richer snapshot)
        const avgVerificationConfidence = PIPELINE_METRICS.verificationIterations > 0
            ? (PIPELINE_METRICS.verificationConfidenceSum / PIPELINE_METRICS.verificationIterations)
            : 0;
        const fallbackRate = PIPELINE_METRICS.messagesTotal > 0
            ? (PIPELINE_METRICS.mockExecutions / PIPELINE_METRICS.messagesTotal)
            : 0;
        const avgConfidenceLegacy = PIPELINE_METRICS.verdicts > 0
            ? (PIPELINE_METRICS.verificationConfidenceSum / PIPELINE_METRICS.verdicts)
            : 0; // legacy equivalent from second handler
        const avgVerificationIterations = PIPELINE_METRICS.verdicts > 0
            ? (PIPELINE_METRICS.verificationIterations / PIPELINE_METRICS.verdicts)
            : 0;

        const response = {
            success: true,
            timestamp: Date.now(),
            pipeline: {
                ...PIPELINE_METRICS,
                avgVerificationConfidence: Number(avgVerificationConfidence.toFixed(3)),
                avgConfidence: Number(avgConfidenceLegacy.toFixed(3)), // alias for compatibility
                avgVerificationIterations: Number(avgVerificationIterations.toFixed(2)),
                fallbackRatePercent: Number((fallbackRate * 100).toFixed(1)),
                fallbackRate: `${(fallbackRate * 100).toFixed(1)}%`,
                probeAdvanceRate: PIPELINE_METRICS.probesStarted ? Number((PIPELINE_METRICS.probesAdvanced / PIPELINE_METRICS.probesStarted * 100).toFixed(1)) : 0,
                probeClarifyRate: PIPELINE_METRICS.probesStarted ? Number((PIPELINE_METRICS.probesClarified / PIPELINE_METRICS.probesStarted * 100).toFixed(1)) : 0,
                avgProbeLatencyMs: PIPELINE_METRICS.probeCycles ? Math.round(PIPELINE_METRICS.probeLatencyMs / PIPELINE_METRICS.probeCycles) : 0
            }
        };

        if (includeProviders) {
            // Provider state snapshot (flattened concise form)
            const state = registry.getState();
            response.providers = Object.values(state.providers || {}).map(p => ({
                name: p.name,
                healthy: p.healthy,
                consecutiveFailures: p.consecutiveFailures,
                failuresTotal: p.failuresTotal || 0,
                cooldownRemainingMs: p.cooldownUntil && Date.now() < p.cooldownUntil ? (p.cooldownUntil - Date.now()) : 0
            }));
        }

        res.json(response);
    } catch (e) {
        res.status(500).json({ error: 'metrics_failed', details: e.message });
    }
});

// Intent classification endpoint (Phase 2 /intent proxy)
app.post('/intent', async (req, res) => {
    try {
        const { message } = req.body;
        
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'message_required', message: 'Message text is required' });
        }

        if (!INTENT_ROUTER_ENABLED) {
            return res.json({ classification: 'actionable', confidence: 0.95, cached: false });
        }

        // Check cache first
        const cacheKey = intentCache.normalizeKey(message);
        let result = intentCache.get(cacheKey);
        
        if (result) {
            return res.json({ ...result, cached: true });
        }

        // Call intent router service
        const response = await fetch(INTENT_ROUTER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            // Fallback to actionable on intent router error
            result = { classification: 'actionable', confidence: 0.95 };
        } else {
            result = await response.json();
        }

        // Cache the result
        intentCache.set(cacheKey, result);
        
        res.json({ ...result, cached: false });
    } catch (error) {
        console.error('Intent classification error:', error);
        // Fallback to actionable on any error
        res.json({ classification: 'actionable', confidence: 0.95, cached: false });
    }
});

// Direct Tetyana endpoint
app.post('/agent/tetyana', async (req, res) => {
    try {
        const { message, sessionId = 'default' } = req.body;
        if (!message?.trim()) {
            return res.status(400).json({ error: 'Message is required' });
        }

        logMessage('info', `Direct Tetyana request: ${message.substring(0, 100)}...`);

        // 1) Виконання: Тетяна працює ТІЛЬКИ через Goose (без провайдерних фолбеків)
        const sys = tetianaSystemInstruction({ enableTools: true });
    // Replaced undefined callGooseAgent with runExecution (same pattern as generateAgentResponse for Tetyana)
    const gooseExec = await runExecution(message, sessionId, { enableTools: true, systemInstruction: sys });
        if (!gooseExec) {
            return res.status(502).json({ error: 'Goose is unavailable for Tetiana' });
        }

        // 2) Короткий звіт: формуємо через openai-compat з окремого списку моделей (до 58)
        let provider = 'goose';
        let model = 'github_copilot';
        let content = null;
        try {
            const reportRoutes = (registry.getRoutes('tetyana', { intentHint: 'short_report' }) || []).filter(r => r.provider === 'openai_compat');
            const reportPrompt = [
                'Сформуй короткий структурований ЗВІТ українською на основі виконання нижче. Формат: РЕЗЮМЕ; КРОКИ; РЕЗУЛЬТАТИ; ДОКАЗИ; ПЕРЕВІРКА; СТАТУС.',
                `Виконання (сирий вивід): ${String(gooseExec).slice(0, 6000)}`
            ].join('\n');
            for (const route of reportRoutes) {
                try {
                    const started = Date.now();
                    const txt = await callOpenAICompatChat(route.baseUrl || FALLBACK_API_BASE, route.model, reportPrompt);
                    if (txt) {
                        content = txt;
                        provider = 'openai_compat';
                        model = route.model;
                        registry.reportSuccess(route, Date.now() - started);
                        break;
                    }
                    registry.reportFailure(route);
                } catch (_) {
                    registry.reportFailure(route);
                }
            }
        } catch (_) { /* ignore summarizer errors, fallback to goose text below */ }

        // 3) Якщо summarizer не спрацював — повертаємо структурований вивід Goose як є
        const finalText = enforceTetianaStructure(content || gooseExec);

        const msg = {
            role: 'assistant',
            content: finalText.startsWith('[ТЕТЯНА]') ? finalText : `[ТЕТЯНА] ${finalText}`,
            agent: 'tetyana',
            messageId: generateMessageId(),
            timestamp: Date.now(),
            voice: 'tetiana',
            color: '#00ffff',
            provider,
            model
        };

        return res.json({
            success: true,
            response: [msg],
            session: { id: sessionId, currentAgent: 'tetyana' }
        });
    } catch (error) {
        logMessage('error', `Tetyana endpoint error: ${error.message}`);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});

app.post('/chat/stream', async (req, res) => {
    const startedAt = Date.now();
    const { message, sessionId, userId, clientMessageId } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    // Idempotency: LRU TTL cache (per process) to avoid re-processing duplicates
    const sid = sessionId || 'default';
    const NOW = Date.now();
    const TTL_MS = 5 * 60 * 1000; // 5 хвилин
    const MAX_ITEMS = 500; // межа для всіх сесій
    if (!global.__clientMsgCache) {
        global.__clientMsgCache = {
            map: new Map(), // key -> { ts, sessionId }
            order: [] // keys by recency (push newest)
        };
    }
    const cache = global.__clientMsgCache;

    function touch(key) {
        // Remove existing
        const idx = cache.order.indexOf(key);
        if (idx >= 0) cache.order.splice(idx, 1);
        cache.order.push(key);
    }
    function prune() {
        // Agent-aware TTL prune: check individual TTL per entry
        for (const [k, meta] of cache.map.entries()) {
            const entryTTL = meta.ttl || TTL_MS; // fallback to global TTL
            const cutoff = NOW - entryTTL;
            if (meta.ts < cutoff) {
                cache.map.delete(k);
                const i = cache.order.indexOf(k);
                if (i >= 0) cache.order.splice(i, 1);
            }
        }
        // Size prune
        while (cache.order.length > MAX_ITEMS) {
            const oldest = cache.order.shift();
            if (oldest) cache.map.delete(oldest);
        }
    }
    prune();

    // Ensure session object exists BEFORE any potential usage (duplicate suppression etc.)
    let session = sessions.get(sid);
    if (!session) {
        session = {
            id: sid,
            history: [],
            currentAgent: 'atlas',
            lastInteraction: Date.now()
        };
        sessions.set(sid, session);
    }
    // Duplicate suppression with flexible agent-specific timeouts
    const DUP_FILTER_DISABLED = process.env.DISABLE_DUPLICATE_FILTER === '1';
    const DUP_BYPASS_HEADER = (req.headers['x-atlas-bypass-dup'] === '1');
    
    // Agent-specific TTL configuration (seconds)
    const getAgentTTL = (agentName) => {
        const agentKey = `ATLAS_DUP_TTL_${(agentName || 'default').toUpperCase()}`;
        const agentTTL = parseInt(process.env[agentKey] || '0', 10);
        if (agentTTL > 0) return agentTTL * 1000; // convert to ms
        
        // Default TTL per agent type
        const defaultTTLs = {
            atlas: parseInt(process.env.ATLAS_DUP_TTL_ATLAS || '120', 10) * 1000,
            grisha: parseInt(process.env.ATLAS_DUP_TTL_GRISHA || '120', 10) * 1000,
            tetyana: parseInt(process.env.ATLAS_DUP_TTL_TETYANA || '120', 10) * 1000,
            user: parseInt(process.env.ATLAS_DUP_TTL_USER || '120', 10) * 1000
        };
        return defaultTTLs[agentName] || parseInt(process.env.ATLAS_DUP_TTL_DEFAULT || '120', 10) * 1000;
    };
    
    if (clientMessageId) {
        const keyBase = `${sid}::${clientMessageId}`;
        const currentAgent = session.currentAgent || 'user';
        const agentTTL = getAgentTTL(currentAgent);
        
        // Clarification resolution: UNCONDITIONAL bypass when awaitingClarification
        if (session.awaitingClarification) {
            const lowerMsg = message.toLowerCase();
            const clarPattern = /(контекст|середовище|критер|інструмент|ціль|мета|уточн|додатков|поясн)/.test(lowerMsg);
            session.awaitingClarification = false;
            session.clarificationJustResolved = true;
            session.clarificationResolvedAt = Date.now();
            // Remove any stale cached key to avoid suppression
            if (global.__clientMsgCache && global.__clientMsgCache.map.has(keyBase)) {
                global.__clientMsgCache.map.delete(keyBase);
            }
            if (process.env.DEBUG_DUPLICATES === '1') {
                logMessage('info', `[clar_bypass] unconditional clarification bypass key=${keyBase} patternMatch=${clarPattern} agent=${currentAgent} ttl=${agentTTL}ms`);
            }
        }
        if (DUP_FILTER_DISABLED || DUP_BYPASS_HEADER) {
            if (process.env.DEBUG_DUPLICATES === '1') {
                logMessage('warn', `[dup_disabled${DUP_BYPASS_HEADER?'/header':''}] bypass duplicate filter cmsg=${clientMessageId}`);
            }
        } else {
            if (cache.map.has(keyBase)) {
                const meta = cache.map.get(keyBase);
                const age = NOW - (meta?.ts || 0);
                // Agent-specific grace period for duplicates
                const gracePeriod = agentTTL;
                
                // Grace: if awaitingClarification and duplicate older than grace period -> treat as fresh retry
                if (session.awaitingClarification && age > gracePeriod) {
                    if (process.env.DEBUG_DUPLICATES === '1') {
                        logMessage('info', `[dup_grace] bypass old duplicate during clarification key=${keyBase} age=${age}ms grace=${gracePeriod}ms agent=${currentAgent}`);
                    }
                    cache.map.delete(keyBase);
                }
                // Edge: empty history but cache hit (stale from previous process)
                if (cache.map.has(keyBase)) { // re-check after potential delete
                    if (session.history.length === 0) {
                        if (process.env.DEBUG_DUPLICATES === '1') {
                            logMessage('info', `[dup_edge] stale cache hit with empty history -> ignoring key=${keyBase} agent=${currentAgent}`);
                        }
                        cache.map.delete(keyBase);
                    } else {
                        const lastUserMsg = session.history.slice().reverse().find(h => h.role === 'user')?.content || '';
                        const norm = s => s.replace(/\s+/g,' ').trim().toLowerCase();
                        const a = norm(lastUserMsg);
                        const b = norm(message);
                        const levenshteinLikeDifferent = Math.abs(a.length - b.length) > 6 || /уточнен/i.test(b) || /це уточнення/i.test(message.toLowerCase());
                        const isDifferentContent = a !== b || levenshteinLikeDifferent;
                        if (!isDifferentContent && !session.clarificationJustResolved) {
                            PIPELINE_METRICS.duplicatesSuppressed++;
                            logMessage('info', `Duplicate clientMessageId suppressed key=${keyBase} agent=${currentAgent} ttl=${agentTTL}ms`);
                            return res.json({
                                success: true,
                                duplicate: true,
                                response: [
                                    {
                                        role: 'system',
                                        agent: 'atlas',
                                        content: `[duplicate_suppressed] Повідомлення з цим clientMessageId вже оброблено (TTL=${Math.round(agentTTL/1000)}s для ${currentAgent}). Нових агентних відповідей немає.`,
                                        timestamp: Date.now(),
                                        type: 'duplicate_suppressed'
                                    }
                                ],
                                session: { id: sid, currentAgent: 'atlas' },
                                metrics: { suppressed: true, agent: currentAgent, ttl: agentTTL }
                            });
                        } else if (process.env.DEBUG_DUPLICATES === '1') {
                            logMessage('info', `Same clientMessageId but different content - allowing key=${keyBase} agent=${currentAgent}`);
                        }
                    }
                }
            }
            // Store after evaluation (first-seen) with agent-specific TTL
            cache.map.set(keyBase, { ts: NOW, sessionId: sid, agent: currentAgent, ttl: agentTTL });
            touch(keyBase);
            if (process.env.DEBUG_DUPLICATES === '1') {
                logMessage('info', `[dup_debug] stored key=${keyBase} ts=${NOW} agent=${currentAgent} ttl=${agentTTL}ms`);
            }
        }
    }

    logMessage('info', `Incoming /chat/stream message (session=${sid} cmsg=${clientMessageId || 'no-id'}): ${String(message).slice(0, 200)}`);

    // Проміжний ACK (offload/accepted) — клієнт може показати статус «Обробка...».
    if (req.headers['x-atlas-ack'] === 'immediate') {
        return res.json({ success: true, accepted: true, session: { id: sid }, message: 'accepted' });
    }

    // Refresh reference (session already ensured above)
    session.lastInteraction = Date.now();

    // Check for user commands
    const messageText = message.toLowerCase().trim();

    // Якщо користувач відповів після запиту уточнення — знімаємо прапор та фіксуємо резолюцію
    if (session.awaitingClarification) {
        session.awaitingClarification = false;
        session.clarificationResolvedAt = Date.now();
    session.forceNewCycle = true; // сигнал ініціювати повний новий цикл (Atlas -> Grisha -> Tetyana)
    session.cycleCount = (session.cycleCount || 0) + 1;
        session.history.push({
            role: 'system',
            content: '[clarification_resolved] Користувач надав додатковий контекст',
            timestamp: Date.now(),
            type: 'clarification_resolved'
        });
    }
    
    // Check for authority command "наказую"
    if (messageText.includes('наказую') || messageText.includes('command')) {
        dialogueManager.setUserAuthority(true);
        session.history.push({
            role: 'user',
            content: message,
            timestamp: Date.now(),
            type: 'command'
        });
        
        return res.json({
            success: true,
            message: 'User authority established',
            shouldContinue: true,
            nextAgent: 'atlas'
        });
    }

    // Check for interruption commands
    if (messageText.includes('stop') || messageText.includes('стоп') || 
        messageText.includes('wait') || messageText.includes('чекай')) {
        
        session.history.push({
            role: 'user', 
            content: message,
            timestamp: Date.now(),
            type: 'interruption'
        });

        return res.json({
            success: true,
            message: 'Processing interrupted by user',
            shouldPause: true,
            awaitingUserInput: true
        });
    }

    // Process regular message through agent system
    try {
        const response = await processAgentCycle(message, session);
        try {
            // Summarize agents and providers for observability
            const meta = (response || []).map(r => `${r.agent}:${r.provider || 'simulation'}${r.model ? '('+r.model+')' : ''}`).join(', ');
            logMessage('info', `Processed message for session=${sessionId || 'n/a'} agents=[${meta}]`);
        } catch {}
        
    // НЕ автозакриваємо розмову після завершення завдання - даємо користувачу можливість продовжити
    // Розмова завершується тільки при явному сигналі або за тайм-аутом бездіяльності  
    const ended = false; // Завжди залишаємо розмову відкритою для нових завдань

        const durationMs = Date.now() - startedAt;
        res.json({
            success: true,
            response: response,
            session: {
                id: sessionId,
                currentAgent: session.currentAgent,
                requiresUserCommand: dialogueManager.requiresUserCommand(),
                nextAction: session.nextAction || null,
                awaitingClarification: !!session.awaitingClarification,
                clarificationJustResolved: !!session.clarificationResolvedAt && (Date.now() - session.clarificationResolvedAt) < 2000
            },
            endOfConversation: ended === true,
            timing: { totalMs: durationMs }
        });

    } catch (error) {
        logMessage('error', `Chat processing failed: ${error.message}`);
        const durationMs = Date.now() - startedAt;
        res.status(500).json({
            error: 'Processing failed',
            details: error.message,
            timing: { totalMs: durationMs }
        });
    }
});

// Compatibility endpoint: support legacy POST /chat
// Normalizes payload and forwards to the same processing as /chat/stream
app.post('/chat', async (req, res) => {
    try {
        // Normalize fields from various clients
        const message = req.body?.message;
        const sessionId = req.body?.sessionId || req.body?.session_id || 'default';
        const userId = req.body?.userId || req.body?.user_id || 'legacy-client';

        if (!message) {
            return res.status(400).json({ error: 'Message is required' });
        }

    logMessage('info', `Incoming /chat message (session=${sessionId}): ${String(message).slice(0, 200)}`);

        // Ensure session exists
        const session = sessions.get(sessionId) || {
            id: sessionId,
            history: [],
            currentAgent: 'atlas',
            lastInteraction: Date.now()
        };
        sessions.set(sessionId, session);

        // Reuse processing logic
        const response = await processAgentCycle(message, session);
        try {
            const meta = (response || []).map(r => `${r.agent}:${r.provider || 'simulation'}${r.model ? '('+r.model+')' : ''}`).join(', ');
            logMessage('info', `Processed legacy /chat for session=${sessionId} agents=[${meta}]`);
        } catch {}

        return res.json({
            success: true,
            response: response.map(r => ({ ...r, phase: r.phase || null })),
            session: {
                id: sessionId,
                currentAgent: session.currentAgent,
                requiresUserCommand: dialogueManager.requiresUserCommand()
            }
        });
    } catch (error) {
        logMessage('error', `Legacy /chat failed: ${error.message}`);
        return res.status(500).json({
            error: 'Processing failed',
            details: error.message
        });
    }
});

// Agent processing cycle
async function processAgentCycle(userMessage, session) {
    const cycleStart = Date.now();
    const responses = [];
    PIPELINE_METRICS.messagesTotal++;
    
    // Add user message to history
    session.history.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now()
    });

    // Колишня доменна логіка виявлення артефактів видалена — все керується через рольові промпти.

    // Phase 1: Atlas creates primary reply/plan (use heuristic intent to bias model choice)
    const preIntent = classifyIntentHeuristic(userMessage, '');
    // Fast-lane: якщо запит чисто детермінований (математика) — відразу повертаємо результат без повного агентного циклу.
    const fastLane = attemptFastLane(userMessage);
    if (fastLane) {
        const msg = tagResponse(fastLane, PHASE.EXECUTION);
        session.history.push(msg);
        clearTimeout(session._clarAutoTimer); // no clarification timers relevant
        return [msg];
    }

    const atlasResponseRaw = await generateAgentResponse('atlas', userMessage, session, { intentHint: preIntent });
    const atlasResponse = tagResponse(atlasResponseRaw, PHASE.ATLAS_PLAN);
    responses.push(atlasResponse);
    session.history.push(atlasResponse);
    try { rememberSafe('atlas', `plan_${Date.now()}`, (atlasResponse.content||'').slice(0,300)); } catch {}

    // If strict TTS sync enabled and we haven't acknowledged Atlas TTS yet, pause here.
    if (!session.intent && applyTtsGate(session, 'atlas_plan')) return responses;

    // Classify user intent to route the flow efficiently (LLM-first with fallback)
    let intent = await classifyIntentSmart(userMessage, atlasResponse.content || '');
    // Якщо щойно завершили уточнення — форсуємо новий цикл як actionable, щоб замкнути петлю виконання
    if (session.forceNewCycle) {
        intent = 'actionable';
        session.forceNewCycle = false; // використали
    }
    session.intent = intent;
    if (intent === 'actionable') {
        try {
            session.actionableSubtype = await classifyActionableSubtypeSmart(userMessage, atlasResponse.content || '');
        } catch (e) {
            session.actionableSubtype = 'generic';
        }
    } else {
        delete session.actionableSubtype;
    }
    logMessage('info', `Intent classified as: ${intent}`);

    // If actionable -> staged pipeline with TTS pacing
    if (intent === 'actionable') {
    PIPELINE_METRICS.actionableSessions++;
        // 1) Grisha precheck now; execution deferred until frontend TTS completes
        const precheckPrompt = [
            'Ти — Гриша. Перед виконанням склади короткий план перевірки і визнач 1-3 точкові дії для Тетяни, які дадуть перевіряємі артефакти.',
            'Відповідай стисло: СПИСОК «ДЛЯ ТЕТЯНИ», де кожен пункт — конкретне завдання з очікуваним артефактом.',
            '',
            `Завдання користувача: ${userMessage}`,
            `План Atlas: ${atlasResponse.content}`
        ].join('\n');
        const grishaPreRaw = await generateAgentResponse('grisha', precheckPrompt, session);
    const grishaPre = tagResponse(grishaPreRaw, PHASE.GRISHA_PRECHECK);
    responses.push(grishaPre);
    session.history.push(grishaPre);
    try { rememberSafe('grisha', `precheck_${Date.now()}`, (grishaPre.content||'').slice(0,300)); } catch {}

    // TTS gate after Grisha precheck
    if (applyTtsGate(session, PHASE.GRISHA_PRECHECK)) return responses;

        // Універсальна ескалація уточнення без доменних хардкодів:
        // Якщо відповідь Гриші містить явні індикатори інформаційного дефіциту ("уточн", "потрібні дані", "надайте", "які саме"),
        // і в сесії ще не зафіксовано, що користувач щось додатково надав після останньої відповіді Atlas — Atlas формує запит на уточнення.
        try {
            const lowerGrisha = (grishaPre.content || '').toLowerCase();
            // Tuned shortage heuristic (менш чутлива): вимагаємо наявність 2+ маркерів або фрази що явно запитує дані
            const shortageMarkers = (lowerGrisha.match(/уточн|потрібн|недостатньо|вкажіть|які саме|provide|missing|need (more|additional)/g) || []);
            const shortage = shortageMarkers.length >= 2;
            if (shortage && !session.awaitingClarification) {
                // Attempt internal probe first (Tetiana) if the shortage looks executable (mentions code/run)
                const probeCandidate = /(код|file|script|run|execute|запусти|створи файл|приклад)/i.test(lowerGrisha);
                if (probeCandidate && (!session.probe || (session.probe && session.probe.attempts < (session.probe.maxAttempts||2)))) {
                    logProbe(`Initiating probe (attempt=${(session.probe?.attempts||0)+1}) for session=${session.id}`);
                    if (!session.probe) {
                        PIPELINE_METRICS.probesStarted++;
                        startProbePipeline(session, userMessage, atlasResponse.content, grishaPre.content);
                        session.probe.startedAt = Date.now();
                    }
                    session.probe.attempts++;
                    PIPELINE_METRICS.probeAttempts++;
                    const atlasRecent = summarizeRecent('atlas', 5);
                    const tetyanaRecent = summarizeRecent('tetyana', 5);
                    const memoryBlock = [atlasRecent && `Попередній контекст Atlas:\n${atlasRecent}`, tetyanaRecent && `Попередні артефакти Тетяни:\n${tetyanaRecent}`].filter(Boolean).join('\n\n');
                    const probePrompt = PROBE_PROMPTS.tetyanaProbe({ userMessage, atlasPlan: atlasResponse.content + (memoryBlock?`\n\n${memoryBlock}`:''), grishaShortage: grishaPre.content });
                    const probeRaw = await generateAgentResponse('tetyana', probePrompt, session, { enableTools: true });
                    logProbe(`Probe execution received (len=${(probeRaw.content||probeRaw||'').length})`);
                    const probeResp = tagResponse(probeRaw, PHASE.TETYANA_PROBE);
                    responses.push(probeResp); session.history.push(probeResp);
                    if (applyTtsGate(session, PHASE.TETYANA_PROBE)) return responses;
                    // Immediately have Grisha review probe
                    const reviewPrompt = PROBE_PROMPTS.grishaReview(probeResp.content + (memoryBlock?`\n\n${memoryBlock}`:''));
                    const reviewRaw = await generateAgentResponse('grisha', reviewPrompt, session);
                    logProbe(`Probe review received (first50="${String(reviewRaw.content||reviewRaw||'').slice(0,50)}")`);
                    const reviewResp = tagResponse(reviewRaw, PHASE.GRISHA_PROBE_REVIEW);
                    responses.push(reviewResp); session.history.push(reviewResp);
                    if (applyTtsGate(session, PHASE.GRISHA_PROBE_REVIEW)) return responses;
                    // Atlas feasibility synthesis
                    const feasPrompt = PROBE_PROMPTS.atlasFeasibility(probeResp.content, reviewResp.content + (atlasRecent?`\n\nІсторія контексту:\n${atlasRecent}`:''));
                    const feasRaw = await generateAgentResponse('atlas', feasPrompt, session);
                    logProbe(`Feasibility response: ${(feasRaw.content||feasRaw||'').slice(0,40)}`);
                    const feasResp = tagResponse(feasRaw, PHASE.ATLAS_FEASIBILITY);
                    responses.push(feasResp); session.history.push(feasResp);
                    if (applyTtsGate(session, PHASE.ATLAS_FEASIBILITY)) return responses;
                    const decision = (feasResp.content||'').trim().toUpperCase().startsWith('ADVANCE');
                    if (decision) {
                        PIPELINE_METRICS.probesAdvanced++;
                        if (session.probe?.startedAt) { PIPELINE_METRICS.probeLatencyMs += (Date.now()-session.probe.startedAt); PIPELINE_METRICS.probeCycles++; }
                        remember('atlas','last_probe_outcome','advance');
                        rememberSafe('grisha',`probe_review_${Date.now()}`, (reviewResp.content||'').slice(0,280));
                        clearProbe(session);
                        // Continue as actionable pipeline and immediately perform Grisha precheck to avoid waiting a new cycle
                        logProbe('Probe ADVANCE confirmed -> transitioning to actionable pipeline');
                        startActionablePipeline(session, userMessage, atlasResponse.content, grishaPre.content);
                        // Emit a synthesized confirmation message (Atlas) to show transition
                        const synth = tagResponse({
                            role: 'assistant',
                            content: 'Пробний крок дав достатньо даних. Переходжу до стандартного виконання.',
                            agent: 'atlas'
                        }, PHASE.ATLAS_FEASIBILITY);
                        responses.push(synth); session.history.push(synth);
                    } else {
                        PIPELINE_METRICS.probesClarified++;
                        if (session.probe?.attempts < (session.probe?.maxAttempts||2)) {
                            // Allow one more probe attempt instead of immediate clarification
                            logProbe('Probe infeasible; scheduling second attempt (no clarification yet)');
                            return responses; // next user / cycle triggers second attempt if shortage persists
                        }
                        if (session.probe?.startedAt) { PIPELINE_METRICS.probeLatencyMs += (Date.now()-session.probe.startedAt); PIPELINE_METRICS.probeCycles++; }
                        remember('atlas','last_probe_outcome','clarify');
                        clearProbe(session);
                        // Fallback to clarification path
                        const atlasClarPrompt = PROBE_PROMPTS.atlasClarificationFallback();
                        const atlasClarRaw = await generateAgentResponse('atlas', atlasClarPrompt, session);
                        logProbe('Probe failed after max attempts -> clarification escalated');
                        const atlasClar = tagResponse(atlasClarRaw, PHASE.ATLAS_PLAN); atlasClar.clarification = true; atlasClar.phase = 'atlas_clarify';
                        responses.push(atlasClar); session.history.push(atlasClar);
                        session.awaitingClarification = true; PIPELINE_METRICS.clarifications++;
                    }
                    return responses;
                }
                const atlasClarPrompt = [
                    'Ти — Atlas. Сформуй короткий структурований ЕТАП 0: що потрібно отримати від користувача для продовження.',
                    'Не вигадуй доменних полів. Лише перефразуй задачу, підкресли, що потрібні уточнення, і наведи список пунктів як маркери (по суті, які дані / контекст / обмеження / початковий стан / очікувані критерії).',
                    'Закінчи інструкцією: «Надайте ці дані однією відповіддю — після цього я згенерую план виконання.»',
                    'Українською. Мінімізуй декоративний текст.'
                ].join('\n');
                const atlasClarRaw = await generateAgentResponse('atlas', atlasClarPrompt, session);
                const atlasClar = tagResponse(atlasClarRaw, PHASE.ATLAS_PLAN);
                atlasClar.clarification = true;
                atlasClar.phase = 'atlas_clarify'; // спеціальна фаза для фронтенду
                responses.push(atlasClar);
                session.history.push(atlasClar);
                session.awaitingClarification = true; scheduleClarificationAutoFill(session);
                PIPELINE_METRICS.clarifications++;
                // Ставимо стан що потрібно більше даних (узагальнені):
                markNeedsMore(session, ['additional_context'], grishaPre.content);
                return responses;
            }
        } catch (e) { logMessage('warn', 'Generic clarification escalation skipped: ' + e.message); }

        startActionablePipeline(session, userMessage, atlasResponse.content, grishaPre.content);

        // Immediate mode: execute right away without waiting for frontend continuation
        if (shouldImmediateExecute(intent)) {
            PIPELINE_METRICS.immediateExecutions++;
            const execPrompt = `Завдання користувача: ${userMessage}\nПлан Atlas: ${atlasResponse.content}\nВимоги Гриші: ${grishaPre.content}\n\nВиконай кроки та чітко звітуй.`;
            const tetyanaExecRaw = await generateAgentResponse('tetyana', execPrompt, session, { enableTools: true });
            const tetyanaExec = tagResponse(tetyanaExecRaw, PHASE.EXECUTION);
            try { 
                tetyanaExec.evidence = extractEvidence(tetyanaExec.content); 
                if (tetyanaExec.evidence && typeof tetyanaExec.evidence.score === 'number') {
                    tetyanaExec.lowEvidence = tetyanaExec.evidence.score < 15; // threshold heuristic
                }
            } catch {}
            responses.push(tetyanaExec);
            session.history.push(tetyanaExec);

            // TTS gate after execution before verification chain
            if (applyTtsGate(session, PHASE.EXECUTION)) { session.pipeline && (session.pipeline.stageAfterExecPending = true); return responses; }
            if (tetyanaExec.lowEvidence) {
                // Force an augmentation request before verification if trivial placeholder content
                const subtype = session.actionableSubtype || 'generic';
                const need = subtype === 'gui_app' ? 'PID та процес (pgrep), часовий штамп запуску' : 'конкретні файли/вихід команд';
                const followMsg = `Недостатньо доказів (score=${tetyanaExec.evidence?.score || 0}). Додай: ${need}. Потім я перевірю.`;
                const grishaEarlyRaw = await generateAgentResponse('grisha', followMsg, session);
                const grishaEarly = tagResponse(grishaEarlyRaw, PHASE.GRISHA_FOLLOWUP);
                responses.push(grishaEarly);
                session.history.push(grishaEarly);
                markNeedsMore(session, [need], tetyanaExec.content);
                return responses; // skip immediate verification until enriched
            }
            const verify = await grishaVerifyWithGoose(userMessage, atlasResponse.content, tetyanaExec.content, session.id);
            const confirmed = verify.confidence >= GRISHA_CONFIDENCE_THRESHOLD;
            let verdictMsg = confirmed
                ? `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО виконаним.`
                : `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів. Посилити перевірку.`;
            
            // Add visual verification info if available
            if (verify.result?.visual_verification) {
                verdictMsg += `\n\nВізуальна верифікація: ${verify.result.visual_verification}`;
            }
            
            const grishaVerdictRaw = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            const grishaVerdict = tagResponse(grishaVerdictRaw, PHASE.GRISHA_VERDICT);
            grishaVerdict.verification = { confidence: verify.confidence, confirmed };
            grishaVerdict.evidence = (verify.result?.criteria || []).map(c => ({ name: c.name, result: c.result, evidence: c.evidence }));
            grishaVerdict.visual_verification = verify.result?.visual_verification;
            PIPELINE_METRICS.verdicts++;
            PIPELINE_METRICS.verificationIterations += verify.iterations || 1;
            PIPELINE_METRICS.verificationConfidenceSum += verify.confidence || 0;
            responses.push(grishaVerdict);
            session.history.push(grishaVerdict);
            try { rememberSafe('grisha', `verdict_${Date.now()}`, `conf=${verify.confidence.toFixed(2)} ${confirmed?'ok':'retry'}`); } catch {}
            if (!confirmed) {
                const missing = (verify.result?.criteria || []).filter(c => c && c.result === false).map(c => c.name);
                const ask = `Потрібно надати додаткові докази по: ${missing.join(', ') || 'не визначено'}. Надати конкретні шляхи/вміст/виходи команд.`;
                const grishaFollowRaw = await generateAgentResponse('grisha', ask, session);
                const grishaFollow = tagResponse(grishaFollowRaw, PHASE.GRISHA_FOLLOWUP);
                PIPELINE_METRICS.followups++;
                responses.push(grishaFollow);
                session.history.push(grishaFollow);
                try { rememberSafe('grisha', `followup_${Date.now()}`, (grishaFollow.content||'').slice(0,260)); } catch {}
                markNeedsMore(session, missing, tetyanaExec.content);
            } else {
                clearPipeline(session);
            }
        } else {
            // staged pipeline (will be continued later)
            PIPELINE_METRICS.stagedPipelines++;
        }
    logMessage('info', `Cycle finished intent=${intent} durationMs=${Date.now()-cycleStart}`);
    return responses;
    }

    // Planning intent handled below; other intents will fall through
    if (intent === 'planning') {
        const grishaRespRaw = await generateAgentResponse('grisha', atlasResponse.content, session);
        const grishaResponse = tagResponse(grishaRespRaw, PHASE.GRISHA_PRECHECK);
        responses.push(grishaResponse);
        session.history.push(grishaResponse);

        // Clarification escalation for planning (avoid stalls)
        try {
            const lowerGrisha = (grishaResponse.content || '').toLowerCase();
            const shortage = /(уточн|потрібн|недостатньо|вкажіть|які саме|provide|missing|need (more|additional))/i.test(lowerGrisha);
            const planningSig = `${(atlasResponse.content||'').slice(0,400)}||${(grishaResponse.content||'').slice(0,400)}`;
            const repeated = session.lastPlanningSignature && session.lastPlanningSignature === planningSig;
            session.lastPlanningSignature = planningSig;
            if (!session.awaitingClarification && (shortage || repeated)) {
                const atlasClarPrompt = [
                    'Ти — Atlas. Користувач сформулював задачу, але потрібні уточнення для переходу до виконання.',
                    '1) Коротко перефразуй задачу одним реченням.',
                    '2) Дай список «Надайте:» (контекст, початковий стан, моделі/пристрої, цільові критерії, обмеження, бажані інструменти).',
                    '3) Заверши: «Надайте ці дані однією відповіддю — після цього я згенерую виконуваний план.»',
                    'Жодних зайвих прикрас.'
                ].join('\n');
                const atlasClarRaw = await generateAgentResponse('atlas', atlasClarPrompt, session);
                const atlasClar = tagResponse(atlasClarRaw, PHASE.ATLAS_PLAN);
                atlasClar.clarification = true;
                atlasClar.phase = 'atlas_clarify';
                responses.push(atlasClar);
                session.history.push(atlasClar);
                session.awaitingClarification = true; scheduleClarificationAutoFill(session);
                PIPELINE_METRICS.clarifications++;
                if (repeated) PIPELINE_METRICS.planningStallClarifications++;
                logMessage('info', `[PLANNING] Clarification escalated (shortage=${shortage} repeated=${repeated})`);
                return responses;
            }
        } catch (e) { logMessage('warn', 'Planning escalation error: ' + e.message); }
    // Disagreement heuristic removed
        try { logMessage('debug', 'Returning planning responses phases=' + responses.map(r => r.phase).join(',')); } catch {}
        return responses;
    }

    try { logMessage('debug', 'Returning simple responses phases=' + responses.map(r => r.phase).join(',')); } catch {}
    logMessage('info', `Cycle finished intent=${intent} durationMs=${Date.now()-cycleStart}`);
    return responses;
}

// Intelligent intent classifier (pure prompt-based system, no hardcoded patterns)
// Returns: 'actionable' | 'planning' | 'qa' | 'smalltalk'
function classifyIntentHeuristic(userText = '', atlasText = '') {
    try {
        // Minimal safety: truly empty/invalid input defaults to planning
        const txt = String(userText || '').trim();
        if (!txt) return 'planning';
        
        // System relies on intelligent LLM classification in classifyIntentSmart()
        // This heuristic serves only as fallback when LLM is unavailable
        // No hardcoded language patterns - all decisions flow through agent prompts
        
        logMessage('debug', `[intent_heuristic] fallback classifier for text='${txt.slice(0,120)}' - deferring to smart classification`);
        return 'planning'; // Conservative fallback, LLM will handle proper classification
    } catch (e) {
        logMessage('warn', `[intent_heuristic] classification error: ${e.message}`);
        return 'planning';
    }
}

// Intelligent intent classification following Atlas → Grisha → Tetiana architecture
async function classifyIntentSmart(userText, atlasText) {
    try {
        const routes = (registry.getRoutes('atlas') || []).filter(r => r.provider === 'openai_compat');
        const prompt = [
            'СИСТЕМА: Atlas → Grisha → Tetiana - планувальник → валідатор → виконавець',
            '',
            'КЛАСИФІКАЦІЯ НАМІРІВ:',
            '- actionable: Конкретні завдання (створити файл, запустити програму, встановити софт, виконати команди)',
            '- planning: Абстрактні питання планування (як зробити, що краще, стратегії)',
            '- qa: Запитання про знання (що таке, як працює, пояснення)',
            '- smalltalk: Привітання, дякую, загальна розмова',
            '',
            'ВАЖЛИВО: Якщо користувач просить ЗРОБИТИ щось конкретне - це завжди actionable!',
            'Приклади actionable: "створи файл", "запусти програму", "встанови пакет", "видали папку"',
            '',
            'Відповідь: тільки одне слово з списку [actionable, planning, qa, smalltalk]',
            '',
            `Повідомлення користувача: ${String(userText || '').slice(0, 2000)}`
        ];
        if (atlasText && String(atlasText).trim()) {
            prompt.push(`Контекст Atlas: ${String(atlasText).slice(0, 1000)}`);
        }
        const promptStr = prompt.join('\n');

        for (const route of routes) {
            try {
                const started = Date.now();
                const out = await callOpenAICompatChatWithTimeout(route.baseUrl || FALLBACK_API_BASE, route.model, promptStr, 1500);
                if (out) {
                    registry.reportSuccess(route, Date.now() - started);
                    const norm = out.trim().toLowerCase();
                    if (['actionable','planning','qa','smalltalk'].includes(norm)) return norm;
                    const token = norm.split(/\s|\W/).find(x => ['actionable','planning','qa','smalltalk'].includes(x));
                    if (token) return token;
                } else {
                    registry.reportFailure(route);
                }
            } catch (_) {
                registry.reportFailure(route);
            }
        }
    } catch {}
    return classifyIntentHeuristic(userText, atlasText);
}

// Continue staged pipeline after TTS completes on the frontend
app.post('/chat/continue', async (req, res) => {
    try {
        const { sessionId } = req.body || {};
        if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
        const session = sessions.get(sessionId);
        if (!session || !session.pipeline) return res.status(400).json({ error: 'No active pipeline for session' });

        const responses = [];
        const pipe = session.pipeline;

        if (pipe.type === 'actionable' && pipe.stage === 'prechecked') {
            // Execute by Tetiana
            const execPrompt = `Завдання користувача: ${pipe.userMessage}\nПлан Atlas: ${pipe.atlasPlan}\nВимоги Гриші: ${pipe.grishaPre}\n\nВиконай кроки та чітко звітуй.`;
            const tetyanaExecRaw = await generateAgentResponse('tetyana', execPrompt, session, { enableTools: true });
            const tetyanaExec = tagResponse(tetyanaExecRaw, PHASE.EXECUTION);
            try { 
                tetyanaExec.evidence = extractEvidence(tetyanaExec.content); 
                if (tetyanaExec.evidence && tetyanaExec.evidence.score < 15) {
                    const subtype = session.actionableSubtype || 'generic';
                    const need = subtype === 'gui_app' ? 'PID процесу калькулятора (pgrep) та час' : 'реальні артефакти (шляхи файлів / виходи команд)';
                    const grishaPrompt = `Попереднє виконання має мало доказів (score=${tetyanaExec.evidence.score}). Попроси Тетяну надати: ${need}.`; 
                    const grishaWarnRaw = await generateAgentResponse('grisha', grishaPrompt, session);
                    const grishaWarn = tagResponse(grishaWarnRaw, PHASE.GRISHA_FOLLOWUP);
                    responses.push(tetyanaExec);
                    session.history.push(tetyanaExec);
                    responses.push(grishaWarn);
                    session.history.push(grishaWarn);
                    markNeedsMore(session, [need], tetyanaExec.content);
                    return responses;
                }
            } catch {}
            responses.push(tetyanaExec);
            session.history.push(tetyanaExec);
            PIPELINE_METRICS.stagedExecutions++;

            // Verify by Grisha
            const verify = await grishaVerifyWithGoose(pipe.userMessage, pipe.atlasPlan, tetyanaExec.content, session.id);
            const confirmed = verify.confidence >= GRISHA_CONFIDENCE_THRESHOLD;
            let verdictMsg = confirmed
                ? `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО виконаним.`
                : `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів. Посилити перевірку.`;
            
            // Add visual verification info if available
            if (verify.result?.visual_verification) {
                verdictMsg += `\n\nВізуальна верифікація: ${verify.result.visual_verification}`;
            }
            
            const grishaVerdictRaw = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            const grishaVerdict = tagResponse(grishaVerdictRaw, PHASE.GRISHA_VERDICT);
            grishaVerdict.verification = { confidence: verify.confidence, confirmed };
            grishaVerdict.evidence = (verify.result?.criteria || []).map(c => ({ name: c.name, result: c.result, evidence: c.evidence }));
            grishaVerdict.visual_verification = verify.result?.visual_verification;
            PIPELINE_METRICS.verdicts++;
            PIPELINE_METRICS.verificationIterations += verify.iterations || 1;
            PIPELINE_METRICS.verificationConfidenceSum += verify.confidence || 0;
            responses.push(grishaVerdict);
            session.history.push(grishaVerdict);

            if (!confirmed) {
                const missing = (verify.result?.criteria || []).filter(c => c && c.result === false).map(c => c.name);
                const ask = `Потрібно надати додаткові докази по: ${missing.join(', ') || 'не визначено'}. Надати конкретні шляхи/вміст/виходи команд.`;
                const grishaFollowRaw = await generateAgentResponse('grisha', ask, session);
                const grishaFollow = tagResponse(grishaFollowRaw, PHASE.GRISHA_FOLLOWUP);
                responses.push(grishaFollow);
                session.history.push(grishaFollow);
                markNeedsMore(session, missing, tetyanaExec.content);
            } else {
                // clear pipeline
                session.pipeline = null;
                session.nextAction = null;
            }
        } else if (pipe.type === 'actionable' && pipe.stage === 'needs_more') {
            pipe.iter = (pipe.iter || 0) + 1;
            const extraPrompt = `Додаткові докази потрібні по: ${pipe.need?.join(', ') || 'не визначено'}. Надати конкретні файли/вміст/виходи команд. Онови звіт.`;
            const tetyanaMoreRaw = await generateAgentResponse('tetyana', extraPrompt, session, { enableTools: true });
            const tetyanaMore = tagResponse(tetyanaMoreRaw, PHASE.EXECUTION);
            try { tetyanaMore.evidence = extractEvidence(tetyanaMore.content); } catch {}
            responses.push(tetyanaMore);
            session.history.push(tetyanaMore);
            PIPELINE_METRICS.stagedExecutions++;

            const verify = await grishaVerifyWithGoose(pipe.userMessage, pipe.atlasPlan, tetyanaMore.content, session.id);
            const confirmed = verify.confidence >= GRISHA_CONFIDENCE_THRESHOLD;
            let verdictMsg = confirmed
                ? `Незалежна повторна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО.`
                : `Незалежна повторна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів.`;
            
            // Add visual verification info if available
            if (verify.result?.visual_verification) {
                verdictMsg += `\n\nВізуальна верифікація: ${verify.result.visual_verification}`;
            }
            const grishaVerdictRaw = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            const grishaVerdict = tagResponse(grishaVerdictRaw, PHASE.GRISHA_VERDICT);
            grishaVerdict.verification = { confidence: verify.confidence, confirmed };
            grishaVerdict.evidence = (verify.result?.criteria || []).map(c => ({ name: c.name, result: c.result, evidence: c.evidence }));
            grishaVerdict.visual_verification = verify.result?.visual_verification;
            PIPELINE_METRICS.verdicts++;
            PIPELINE_METRICS.verificationIterations += verify.iterations || 1;
            PIPELINE_METRICS.verificationConfidenceSum += verify.confidence || 0;
            responses.push(grishaVerdict);
            session.history.push(grishaVerdict);

            if (!confirmed && pipe.iter < GRISHA_MAX_VERIFY_ITER) {
                const missing = (verify.result?.criteria || []).filter(c => c && c.result === false).map(c => c.name);
                const ask = `Ще потрібно посилити докази по: ${missing.join(', ') || 'не визначено'}.`;
                const grishaFollowRaw = await generateAgentResponse('grisha', ask, session);
                const grishaFollow = tagResponse(grishaFollowRaw, PHASE.GRISHA_FOLLOWUP);
                responses.push(grishaFollow);
                session.history.push(grishaFollow);
                pipe.need = missing;
                session.nextAction = 'tetyana_supplement';
            } else {
                session.pipeline = null;
                session.nextAction = null;
            }
        }

    // Залишаємо розмову відкритою для нових завдань користувача
    const ended = false;

        res.json({
            success: true,
            response: responses.map(r => ({ ...r, phase: r.phase || null })),
            session: {
                id: session.id,
                currentAgent: session.currentAgent,
                requiresUserCommand: dialogueManager.requiresUserCommand(),
                nextAction: session.nextAction || null
            },
            endOfConversation: ended === true
        });
    } catch (error) {
        logMessage('error', `/chat/continue failed: ${error.message}`);
        res.status(500).json({ error: 'continue failed', details: error.message });
    }
});

// Endpoint the frontend calls after finishing TTS playback for a phase (currently Atlas)
app.post('/tts/done', async (req, res) => {
    try {
        const { sessionId, phase } = req.body || {};
        if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
        const session = sessions.get(sessionId);
        if (!session) return res.status(404).json({ error: 'session not found' });
        if (!STRICT_TTS) return res.json({ success: true, skipped: true, message: 'STRICT_TTS disabled' });

        session.ttsGate = session.ttsGate || {};
        // Mark current phase done (basic validation optional)
        if (phase) session.ttsGate[`${phase}Done`] = true;
        // Specifically handle atlas_plan gating
        if (session.ttsGate.pendingPhase === 'atlas_plan' && session.ttsGate.atlas_planDone !== false) {
            session.ttsGate.atlasDone = true;
            delete session.ttsGate.pendingPhase;
        }

        // If there is a last user message we can resume processing from, re-run the remainder of cycle.
        const lastUserMsg = [...session.history].reverse().find(m => m.role === 'user');
        if (!lastUserMsg) return res.json({ success: true, resumed: false, message: 'No user message to resume from' });

        // Continue only if we paused after Atlas (intent not yet classified)
        if (!session.intent && session.ttsGate.atlasDone) {
            const responses = await processAgentCycleResumeAfterAtlas(session, lastUserMsg.content);
            return res.json({ success: true, resumed: true, response: responses, session: { id: session.id, currentAgent: session.currentAgent } });
        }
        // Resume after Grisha precheck gate (immediate path)
        if (phase === PHASE.GRISHA_PRECHECK) {
            const responses = await processAgentCycleResumeAfterGrishaPre(session);
            if (responses.length) return res.json({ success: true, resumed: true, response: responses, session: { id: session.id } });
        }
        // Resume after probe phases (sequential: tetyana_probe -> grisha_probe_review -> atlas_feasibility handled inline in initial cycle; if gated, resume progression)
        if (phase === PHASE.TETYANA_PROBE) {
            // Find last probe response and continue with review + feasibility if not already present
            const hasReview = session.history.some(m => m.phase === PHASE.GRISHA_PROBE_REVIEW);
            if (!hasReview) {
                const probeResp = [...session.history].reverse().find(m => m.phase === PHASE.TETYANA_PROBE);
                if (probeResp) {
                    const reviewPrompt = [
                        'Ти — Гриша. Оціни чи пробний крок дав достатньо даних, щоб продовжити без користувача.',
                        'Відповідь: FEASIBLE|INFEASIBLE на початку рядка, потім коротко що є/чого бракує.',
                        `Пробний звіт Тетяни: ${probeResp.content}`
                    ].join('\n');
                    const reviewRaw = await generateAgentResponse('grisha', reviewPrompt, session);
                    const reviewResp = tagResponse(reviewRaw, PHASE.GRISHA_PROBE_REVIEW);
                    session.history.push(reviewResp);
                    if (applyTtsGate(session, PHASE.GRISHA_PROBE_REVIEW)) return res.json({ success: true, resumed: true, response: [reviewResp], session: { id: session.id } });
                    const feasPrompt = [
                        'Ти — Atlas. На основі проби і ревʼю відповідай одним словом: ADVANCE або CLARIFY. Потім стислий коментар.',
                        `Проба: ${probeResp.content}`,
                        `Ревʼю: ${reviewResp.content}`
                    ].join('\n');
                    const feasRaw = await generateAgentResponse('atlas', feasPrompt, session);
                    const feasResp = tagResponse(feasRaw, PHASE.ATLAS_FEASIBILITY);
                    session.history.push(feasResp);
                    const decision = (feasResp.content||'').trim().toUpperCase().startsWith('ADVANCE');
                    if (decision) {
                        PIPELINE_METRICS.probesAdvanced++;
                        if (session.probe?.startedAt) { PIPELINE_METRICS.probeLatencyMs += (Date.now()-session.probe.startedAt); PIPELINE_METRICS.probeCycles++; }
                        remember('atlas','last_probe_outcome','advance');
                        clearProbe(session);
                    } else {
                        PIPELINE_METRICS.probesClarified++;
                        if (session.probe?.startedAt) { PIPELINE_METRICS.probeLatencyMs += (Date.now()-session.probe.startedAt); PIPELINE_METRICS.probeCycles++; }
                        remember('atlas','last_probe_outcome','clarify');
                        clearProbe(session); session.awaitingClarification = true; PIPELINE_METRICS.clarifications++;
                    }
                    return res.json({ success: true, resumed: true, response: [reviewResp, feasResp], session: { id: session.id } });
                }
            }
        }
        // Resume after execution gate (immediate path)
        if (phase === PHASE.EXECUTION) {
            const responses = await processAgentCycleResumeAfterTetyanaExec(session);
            if (responses.length) return res.json({ success: true, resumed: true, response: responses, session: { id: session.id } });
        }
        return res.json({ success: true, resumed: false, message: 'Nothing pending' });
    } catch (e) {
        logMessage('error', `/tts/done failed: ${e.message}`);
        res.status(500).json({ error: 'tts done failed', details: e.message });
    }
});

// Helper to finish cycle after Atlas TTS gate released
async function processAgentCycleResumeAfterAtlas(session, userMessage) {
    // We intentionally do not push the user message again.
    const atlasResponse = [...session.history].reverse().find(m => m.phase === PHASE.ATLAS_PLAN);
    if (!atlasResponse) return [];
    const responses = [atlasResponse];
    let intent = await classifyIntentSmart(userMessage, atlasResponse.content || '');
    if (session.forceNewCycle) { intent = 'actionable'; session.forceNewCycle = false; }
    session.intent = intent;
    if (intent === 'actionable') {
        try { session.actionableSubtype = await classifyActionableSubtypeSmart(userMessage, atlasResponse.content || ''); } catch { session.actionableSubtype = 'generic'; }
        PIPELINE_METRICS.actionableSessions++;
        const precheckPrompt = [
            'Ти — Гриша. Перед виконанням склади короткий план перевірки і визнач 1-3 точкові дії для Тетяни, які дадуть перевіряємі артефакти.',
            'Відповідай стисло: СПИСОК «ДЛЯ ТЕТЯНИ», де кожен пункт — конкретне завдання з очікуваним артефактом.',
            '',
            `Завдання користувача: ${userMessage}`,
            `План Atlas: ${atlasResponse.content}`
        ].join('\n');
        const grishaPreRaw = await generateAgentResponse('grisha', precheckPrompt, session);
        const grishaPre = tagResponse(grishaPreRaw, PHASE.GRISHA_PRECHECK);
        responses.push(grishaPre); session.history.push(grishaPre);
    if (applyTtsGate(session, PHASE.GRISHA_PRECHECK)) return responses;
        try {
            const lowerGrisha = (grishaPre.content || '').toLowerCase();
            const shortage = /(уточн|потрібн[аоі]|недостатньо|вкажіть|які саме|provide|missing|need (more|additional))/i.test(lowerGrisha);
            if (shortage && !session.awaitingClarification) {
                const atlasClarPrompt = [
                    'Ти — Atlas. Користувач сформулював задачу, але потрібні уточнення для переходу до виконання.',
                    '1) Коротко перефразуй задачу одним реченням.',
                    '2) Дай список «Надайте:» (контекст, початковий стан, моделі/пристрої, цільові критерії, обмеження, бажані інструменти).',
                    '3) Заверши: «Надайте ці дані однією відповіддю — після цього я згенерую виконуваний план.»',
                    'Жодних зайвих прикрас.'
                ].join('\n');
                const atlasClarRaw = await generateAgentResponse('atlas', atlasClarPrompt, session);
                const atlasClar = tagResponse(atlasClarRaw, PHASE.ATLAS_PLAN);
                atlasClar.clarification = true; atlasClar.phase = 'atlas_clarify';
                responses.push(atlasClar); session.history.push(atlasClar);
                session.awaitingClarification = true; PIPELINE_METRICS.clarifications++;
                markNeedsMore(session, ['additional_context'], grishaPre.content);
                try { scheduleClarificationAutoFill(session); } catch(e){ logMessage('warn','Clarification auto-fill scheduling failed: '+e.message); }
                return responses;
            }
        } catch {}
        startActionablePipeline(session, userMessage, atlasResponse.content, responses.find(r=>r.phase===PHASE.GRISHA_PRECHECK)?.content || '');
        if (shouldImmediateExecute(intent)) {
            const execPrompt = `Завдання користувача: ${userMessage}\nПлан Atlas: ${atlasResponse.content}\nВимоги Гриші: ${responses.find(r=>r.phase===PHASE.GRISHA_PRECHECK)?.content || ''}\n\nВиконай кроки та чітко звітуй.`;
            const tetyanaExecRaw = await generateAgentResponse('tetyana', execPrompt, session, { enableTools: true });
            const tetyanaExec = tagResponse(tetyanaExecRaw, PHASE.EXECUTION); responses.push(tetyanaExec); session.history.push(tetyanaExec);
            if (applyTtsGate(session, PHASE.EXECUTION)) { session.pipeline && (session.pipeline.stageAfterExecPending = true); return responses; }
        }
        return responses;
    }
    if (intent === 'planning') {
        const grishaRespRaw = await generateAgentResponse('grisha', atlasResponse.content, session);
        const grishaResponse = tagResponse(grishaRespRaw, PHASE.GRISHA_PRECHECK);
        responses.push(grishaResponse); session.history.push(grishaResponse);
        // Auto-promotion heuristic: if user initial message clearly contains executable filesystem directive
        try {
            const lowerUser = (userMessage||'').toLowerCase();
            const lowerPlan = (atlasResponse.content||'').toLowerCase();
            const execSignal = /(створ(и|ити)|создай|create)\s+.*(папк|folder|directory)|\b(запиши|write)\b.*(файл|file)/.test(lowerUser);
            const notShortage = !/(уточн|потрібн|недостатньо|missing|need more)/.test((grishaResponse.content||'').toLowerCase());
            if (execSignal && notShortage) {
                PIPELINE_METRICS.planningPromotions++;
                session.intent = 'actionable';
                // Start pipeline immediately so next /chat/continue (or immediate mode) виконає Тетяну
                startActionablePipeline(session, userMessage, atlasResponse.content, grishaResponse.content);
                if (shouldImmediateExecute('actionable')) {
                    const execPrompt = `Завдання користувача: ${userMessage}\nПлан Atlas: ${atlasResponse.content}\nВимоги Гриші: ${grishaResponse.content}\n\nВиконай кроки та чітко звітуй.`;
                    const tetyanaExecRaw = await generateAgentResponse('tetyana', execPrompt, session, { enableTools: true });
                    const tetyanaExec = tagResponse(tetyanaExecRaw, PHASE.EXECUTION);
                    responses.push(tetyanaExec); session.history.push(tetyanaExec);
                }
            } else {
                // If Grisha explicitly signals shortage twice in planning loop -> escalate clarification metrics
                if (/(уточн|потрібн|недостатньо|missing|need more)/.test((grishaResponse.content||'').toLowerCase())) {
                    PIPELINE_METRICS.planningStallClarifications++;
                }
            }
        } catch(_) {}
    }
    return responses;
}

// Expose pipeline metrics (ephemeral, resets on restart)
// (Removed duplicate /metrics/pipeline handler and unified logic above)

// Heuristic actionable detection removed — rely on LLM intent classification only.
function isActionableTask(_text) { return false; }

// Legacy static plan removed: dynamic routing handled by ModelRegistry

// Real agent integration
async function generateAgentResponse(agentName, inputMessage, session, options = {}) {
    const agentStartTime = Date.now();
    const agent = AGENTS[agentName];
    const messageId = generateMessageId();
    // If strict TTS mode is enabled, apply TTS gate for this agent's fast summary phase
    try {
        if (STRICT_TTS && session) {
            applyTtsGate(session, `${agentName}_tts`);
        }
    } catch (e) {}
    
    // Check circuit breaker state before execution
    if (isCircuitBreakerOpen()) {
        logMessage('warn', `[CIRCUIT_BREAKER] Request blocked for ${agentName}, cooldown: ${PIPELINE_METRICS.circuitBreaker.cooldownRemaining}ms`);
        const fallbackContent = `[${agent.signature}] Система тимчасово недоступна. Спробуйте через ${Math.ceil(PIPELINE_METRICS.circuitBreaker.cooldownRemaining / 1000)} секунд.`;
        return {
            id: messageId,
            agentName,
            content: fallbackContent,
            provider: 'circuit_breaker',
            model: 'fallback',
            timestamp: new Date().toISOString(),
            timing: { agentMs: Date.now() - agentStartTime, route: 'circuit_breaker' }
        };
    }
    
    // Create role-based prompt
    let prompt = createAgentPrompt(agentName, inputMessage, session);
    
    let content;
    let provider = undefined;
    let model = undefined;
    let executionSuccessful = false;
    
    if (agentName === 'tetyana') {
        // Start Grisha visual monitoring before execution
        const taskDescription = `Виконання завдання: ${inputMessage.substring(0, 100)}...`;
        await startGrishaVisualMonitoring(session.id, taskDescription);
        
        // Execution via Goose only (no provider fallbacks for execution)
        const execStartTime = Date.now();
        const execNotes = await runExecution(prompt, session.id, {
            enableTools: options.enableTools === true,
            systemInstruction: tetianaSystemInstruction({ enableTools: options.enableTools === true })
        });
        const execDuration = Date.now() - execStartTime;
        logMessage('info', `[TIMING] agent=tetyana phase=execution ms=${execDuration} success=${!!execNotes}`);

        // Stop visual monitoring after execution
        const monitoringResult = await stopGrishaVisualMonitoring();
        
        if (!execNotes) {
            // Execution failed -> return blocked status without switching providers
            const blocked = 'РЕЗЮМЕ: Виконання недоступне (Goose недоступний).\nСТАТУС: Blocked — повторити пізніше або перевірити підключення.';
            content = enforceTetianaStructure(blocked);
            provider = 'goose';
            model = 'github_copilot';
            recordCircuitBreakerFailure();
            // Report Goose failure to registry
            registry.reportFailure({ provider: 'goose', model: 'github_copilot' }, new Error('Goose execution failed'));
        } else {
            // Report Goose success to registry
            registry.reportSuccess({ provider: 'goose', model: 'github_copilot' }, Date.now() - execStartTime);
            // Short structured report via openai-compat using configured 58-model list
            const reportStartTime = Date.now();
            const reportRoutes = (registry.getRoutes('tetyana', { intentHint: 'short_report' }) || []).filter(r => r.provider === 'openai_compat');
            const reportPrompt = [
                'Сформуй короткий структурований ЗВІТ українською на основі виконання нижче. Формат: РЕЗЮМЕ; КРОКИ; РЕЗУЛЬТАТИ; ДОКАЗИ; ПЕРЕВІРКА; СТАТУС.',
                `Виконання (сирий вивід): ${String(execNotes).slice(0, 6000)}`
            ].join('\n');
            let reportText = null;
            for (const route of reportRoutes) {
                const routeStartTime = Date.now();
                try {
                    const started = Date.now();
                    const txt = await callOpenAICompatChat(route.baseUrl || FALLBACK_API_BASE, route.model, reportPrompt);
                    const routeDuration = Date.now() - routeStartTime;
                    if (txt) {
                        reportText = txt;
                        registry.reportSuccess(route, Date.now() - started);
                        provider = 'openai_compat';
                        model = route.model;
                        executionSuccessful = true;
                        logMessage('info', `[TIMING] agent=tetyana phase=report route=${route.model} ms=${routeDuration} success=true`);
                        break;
                    }
                    registry.reportFailure(route, new Error('Empty response from model'));
                    logMessage('info', `[TIMING] agent=tetyana phase=report route=${route.model} ms=${routeDuration} success=false`);
                } catch (err) {
                    const routeDuration = Date.now() - routeStartTime;
                    registry.reportFailure(route, err);
                    logMessage('info', `[TIMING] agent=tetyana phase=report route=${route.model} ms=${routeDuration} error=${err.message}`);
                }
            }
            const reportDuration = Date.now() - reportStartTime;
            logMessage('info', `[TIMING] agent=tetyana phase=report_total ms=${reportDuration} routes_tried=${reportRoutes.length}`);
            const base = reportText || execNotes;
            content = enforceTetianaStructure(base);
            if (!provider) { provider = 'goose'; model = 'github_copilot'; }
        }
    } else {
        // Dynamic provider/model routing via registry for Atlas/Grisha
        const sysInstr = (agentName === 'atlas')
            ? 'Ти — ATLAS (стратег). Стисло сформуй план дій з чіткими кроками та точками контролю. Уникай води.'
            : 'Ти — ГРИША (контролер). Перевір план на безпеку та здійсненність, дай стислий конструктивний фідбек.';

    // Отримати маршрути з урахуванням наміру (intent-aware пріоритет у ModelRegistry)
    const routes = registry.getRoutes(agentName, { intentHint: (options?.intentHint) || session.intent });
        for (const route of routes) {
            const routeStartTime = Date.now();
            const started = Date.now();
            try {
                if (route.provider === 'goose') {
                    const gooseText = await runExecution(prompt, session.id, { enableTools: false, systemInstruction: sysInstr });
                    const routeDuration = Date.now() - routeStartTime;
                    if (gooseText) {
                        content = gooseText;
                        provider = 'goose';
                        model = route.model || 'github_copilot';
                        registry.reportSuccess(route, Date.now() - started);
                        executionSuccessful = true;
                        logMessage('info', `[TIMING] agent=${agentName} route=goose model=${model} ms=${routeDuration} success=true`);
                        break;
                    }
                    registry.reportFailure(route, new Error('Empty response from Goose'));
                    logMessage('info', `[TIMING] agent=${agentName} route=goose model=${model} ms=${routeDuration} success=false`);
                } else if (route.provider === 'openai_compat') {
                    const text = await callOpenAICompatChat(route.baseUrl || FALLBACK_API_BASE, route.model, prompt);
                    const routeDuration = Date.now() - routeStartTime;
                    if (text) {
                        content = text;
                        provider = 'openai_compat';
                        model = route.model;
                        registry.reportSuccess(route, Date.now() - started);
                        executionSuccessful = true;
                        logMessage('info', `[TIMING] agent=${agentName} route=openai_compat model=${model} ms=${routeDuration} success=true`);
                        break;
                    }
                    registry.reportFailure(route, new Error('Empty response from OpenAI model'));
                    logMessage('info', `[TIMING] agent=${agentName} route=openai_compat model=${model} ms=${routeDuration} success=false`);
                }
            } catch (err) {
                const routeDuration = Date.now() - routeStartTime;
                registry.reportFailure(route, err);
                logMessage('info', `[TIMING] agent=${agentName} route=${route.provider} model=${route.model} ms=${routeDuration} error=${err.message}`);
                // keep trying next route
            }
        }

        if (!content) {
            // Deterministic minimal fallback (single structured notice)
            PIPELINE_METRICS.mockExecutions++;
            recordCircuitBreakerFailure();
            logMessage('info', `[TIMING] agent=${agentName} fallback=true routes_tried=${routes.length} ms=${Date.now() - agentStartTime}`);
            if (agentName === 'atlas') {
                content = 'План тимчасово недоступний через провайдерів. Мінімальний fallback: сформулюйте кроки: 1) Аналіз 2) Виконання 3) Перевірка.';
            } else if (agentName === 'grisha') {
                content = 'Валідація не виконана (fallback). Потрібні докази: файл(и), результат команди, підтвердження стану.';
            } else {
                content = 'Резервна відповідь агента.';
            }
        } else {
            // Successful execution
            executionSuccessful = true;
        }
    }
    
    // Record circuit breaker state based on execution result
    if (executionSuccessful) {
        recordCircuitBreakerSuccess();
    }
    
    // Attempt to produce a short 3-5 sentence TTS-friendly summary in 'fast' mode.
    // Use openai_compat routes where available with a short timeout; fall back to truncated content.
    let ttsSummary = null;
    let ttsProvider = null;
    let ttsModel = null;
    try {
        const ttsPrompt = `Стисле резюме для швидкого TTS (3-5 речень) українською: ${String(content).slice(0, 3000)}`;
        const summaryRoutes = (registry.getRoutes(agentName, { intentHint: 'tts_summary' }) || []).filter(r => r.provider === 'openai_compat');
        for (const route of summaryRoutes) {
            try {
                const started = Date.now();
                const txt = await callOpenAICompatChatWithTimeout(route.baseUrl || FALLBACK_API_BASE, route.model, ttsPrompt, 1200);
                const dur = Date.now() - started;
                if (txt) {
                    ttsSummary = txt.replace(/\s+/g, ' ').trim();
                    ttsProvider = 'openai_compat';
                    ttsModel = route.model;
                    registry.reportSuccess(route, dur);
                    break;
                }
                registry.reportFailure(route, new Error('empty tts summary'));
            } catch (err) {
                registry.reportFailure(route, err);
            }
        }
        // If none from prioritized routes, try general openai_compat list
        if (!ttsSummary) {
            const fallbackRoutes = (registry.getRoutes(agentName) || []).filter(r => r.provider === 'openai_compat');
            for (const route of fallbackRoutes) {
                try {
                    const started = Date.now();
                    const txt = await callOpenAICompatChatWithTimeout(route.baseUrl || FALLBACK_API_BASE, route.model, ttsPrompt, 1200);
                    const dur = Date.now() - started;
                    if (txt) {
                        ttsSummary = txt.replace(/\s+/g, ' ').trim();
                        ttsProvider = 'openai_compat';
                        ttsModel = route.model;
                        registry.reportSuccess(route, dur);
                        break;
                    }
                    registry.reportFailure(route, new Error('empty tts summary fallback'));
                } catch (err) {
                    registry.reportFailure(route, err);
                }
            }
        }
    } catch (e) {
        // swallow - tts summary best-effort only
    }
    // If strict TTS gating is active, ensure the gate is cleared only when we have a summary.
    try {
        if (STRICT_TTS && session) {
            session.ttsGate = session.ttsGate || {};
            const doneKey = `${agentName}_ttsDone`;
            if (ttsSummary) {
                session.ttsGate[doneKey] = true;
                // Clear pendingPhase if it references this agent
                if (session.ttsGate.pendingPhase === `${agentName}_tts`) delete session.ttsGate.pendingPhase;
                console.log(`[TTS] fast summary ready for ${agentName}, clearing gate`);
            } else {
                // Leave pendingPhase set so pipeline respects TTS requirement
                session.ttsGate.pendingPhase = session.ttsGate.pendingPhase || `${agentName}_tts`;
                console.warn(`[TTS] fast summary NOT produced for ${agentName}; pipeline will wait until TTS available`);
            }
        }
    } catch (e) {}

    const totalAgentTime = Date.now() - agentStartTime;
    logMessage('info', `[TIMING] agent=${agentName} total_ms=${totalAgentTime} provider=${provider} model=${model} success=${executionSuccessful}`);

    return {
        role: 'assistant',
        content: `${agent.signature} ${content.replace(/^\[ТЕТЯНА\]\s*/i, '')}`,
        agent: agentName,
        messageId: messageId,
        timestamp: Date.now(),
        voice: agent.voice,
        color: agent.color,
        provider,
        model,
        timing: { agentMs: totalAgentTime, provider, model },
        tts: {
            mode: 'fast',
            summary: ttsSummary || String(content).slice(0, 200).replace(/\s+/g,' ').trim(),
            provider: ttsProvider,
            model: ttsModel
        }
    };
}


// Simulate agent thinking (for Atlas and Grisha)

// Create prompts based on agent roles
function createAgentPrompt(agentName, message, session) {
    const baseContext = `You are ${agentName.toUpperCase()}, a specialized AI agent in the ATLAS system.`;
    // Lightweight memory integration (recent persisted facts). Only Atlas & Grisha use shared memory.
    let memoryBlock = '';
    try {
        if (agentName === 'atlas' || agentName === 'grisha') {
            const targetTokens = parseInt(process.env.ATLAS_MEMORY_TARGET_TOKENS || '320',10);
            const atlasBlock = summarizeForPrompt('atlas', { targetTokens });
            const grishaBlock = summarizeForPrompt('grisha', { targetTokens });
            const parts = [];
            if (atlasBlock) parts.push(`Ранжовані факти Atlas:\n${atlasBlock}`);
            if (grishaBlock) parts.push(`Ранжовані факти Гриші:\n${grishaBlock}`);
            // Optional semantic augmentation if enabled and query (last user message) exists
            try {
                if (process.env.ATLAS_MEMORY_EMBEDDINGS === '1' && session.messages?.length) {
                    const lastUser = [...session.messages].reverse().find(m=>m.role==='user');
                    if (lastUser) {
                        const semA = semanticContext('atlas', lastUser.content||'', { topK:3, maxChars:400 });
                        const semG = semanticContext('grisha', lastUser.content||'', { topK:3, maxChars:400 });
                        if (semA) parts.push(`Семантичні факти Atlas:\n${semA}`);
                        if (semG) parts.push(`Семантичні факти Гриші:\n${semG}`);
                    }
                }
            } catch {}
            if (parts.length) memoryBlock = `\n\n[ПАМ'ЯТЬ]\n${parts.join('\n\n')}`;
        }
    } catch {}
    
    switch (agentName) {
        case 'atlas':
            return `${baseContext} Ти — ATLAS, стратег. Твоє завдання: швидко перефразувати запит користувача українською зрозумілою мовою, окреслити суть і контекст, виділити ключові вимоги і ризики. Без детальної нумерації кроків — це робота Тетяни. Якщо бракує даних, сформулюй 1–2 точні питання до користувача або до Тетяни.${memoryBlock}

Запит користувача: ${message}
Нещодавній контекст: ${getRecentHistory(session, 3)}

Стиль: стисло, по суті, дружньо, з легкими живими зверненнями за потреби (без заучених фраз).`;

        case 'grisha':
            return `${baseContext} Ти — Гриша, валідаційний агент. Перша перевірка — одразу після перефразування від ATLAS: оцінка ризиків і безпеки, вкажи на слабкі місця. Друга перевірка — після звіту Тетяни: валідуй, що завдання справді виконано за критеріями. Якщо не виконано — чітко вкажи, що саме не так, і які докази потрібні.${memoryBlock}

Матеріал для перевірки: ${message}
Сесійний контекст: ${getRecentHistory(session, 3)}

Стиль: обережний, конкретний, без води, з акцентом на доказах і безпеці.`;

        case 'tetyana':
            return `${baseContext} Ти — Тетяна, виконавиця. Отримуєш від ATLAS перефразований запит і вимоги від Гриші. Твоя відповідь — структурований український звіт (РЕЗЮМЕ, КРОКИ, РЕЗУЛЬТАТИ з конкретикою, ДОКАЗИ, ПЕРЕВІРКА, СТАТУС). Якщо щось блокує — коротко зазнач причину і що потрібно для продовження.

Контекст завдання: ${message}
Сесійний контекст: ${getRecentHistory(session, 3)}

Стиль: чітко, лаконічно, без зайвого, орієнтовано на виконання.`;

        default:
            return `${baseContext} Respond appropriately to: ${message}`;
    }
}

// simulateAgentThinking removed (deterministic fallback inlined above)

// Helper functions
// Discussion / disagreement heuristics removed (model-driven reasoning only)

function getRecentHistory(session, count = 3) {
    return session.history
        .slice(-count)
        .map(msg => `${msg.role}: ${msg.content.substring(0, 200)}`)
        .join('\n');
}

// ----------------------------
// Grisha independent verification via Goose
// ----------------------------

function grishaVerificationSessionId(baseSessionId) {
    const ts = Date.now();
    return `${baseSessionId || 'default'}-grisha-verify-${ts}`;
}

function extractJson(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    // 1. Fenced ```json blocks
    const fenced = s.match(/```json[\r\n]+([\s\S]*?)```/i);
    if (fenced) {
        try { return JSON.parse(fenced[1]); } catch { /* ignore */ }
    }
    // 2. Balance braces scan (forward)
    let best = null; let depth = 0; let buf = '';
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === '{') { depth++; }
        if (depth > 0) buf += ch;
        if (ch === '}') {
            depth--; if (depth === 0) { // complete candidate
                try { best = JSON.parse(buf); } catch { /* ignore */ }
                buf = ''; // continue searching last valid
            }
        }
    }
    if (best) return best;
    // 3. Last resort (original heuristic)
    const start = s.lastIndexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        try { return JSON.parse(s.slice(start, end + 1)); } catch {}
    }
    return null;
}

async function grishaVerifyWithGoose(userMessage, atlasPlan, tetyanaReport, baseSessionId) {
    const verifySession = grishaVerificationSessionId(baseSessionId);
    let iteration = 0;
    let confidence = 0;
    let lastResult = null;
    let notes = [];

    // Ensure visual monitoring is enabled for this verification cycle.
    // Start monitoring if frontend supports it; always attempt to stop in finally.
    let monitoringStarted = false;
    try {
        const taskDescription = `Валідація: ${String(atlasPlan || userMessage).slice(0, 120)}`;
        const startRes = await startGrishaVisualMonitoring(baseSessionId, taskDescription);
        monitoringStarted = !!startRes && !!startRes.success;
        if (monitoringStarted) {
            console.log(`[GRISHA] Visual monitoring ensured for verification session ${verifySession}`);
        } else {
            console.log(`[GRISHA] Visual monitoring not started or already running for session ${verifySession}`);
        }
    } catch (e) {
        console.warn(`[GRISHA] Failed to start visual monitoring before verification: ${e.message}`);
    }

    // Get visual evidence from monitoring (may be empty if frontend didn't start or no frames captured)
    const visualEvidence = await getGrishaVisualEvidence();
    const hasVisualEvidence = visualEvidence && visualEvidence.length > 0;
    
    let visualEvidenceText = '';
    if (hasVisualEvidence) {
        visualEvidenceText = '\n\nВІЗУАЛЬНІ ДОКАЗИ:\n';
        visualEvidence.forEach((evidence, idx) => {
            visualEvidenceText += `${idx + 1}. ${evidence.description} (${evidence.type}) - ${evidence.timestamp}\n`;
        });
        visualEvidenceText += `\nВсього візуальних доказів: ${visualEvidence.length}\n`;
    }

    while (iteration < GRISHA_MAX_VERIFY_ITER) {
        iteration++;
        const verifyPrompt = [
            'Ти — Гриша, незалежний валідаційний агент. Твоє завдання — ПЕРЕВІРИТИ твердження Тетяни незалежно, використовуючи:',
            '1. Доступ до системи (файли/OS/додатки)',
            '2. Візуальні докази з моніторингу екрану під час виконання',
            'Працюй акуратно, виконуй перевірки інструментами, якщо потрібно.',
            'Поверни РІВНО JSON з полями:',
            '{ "criteria": [ { "name": string, "result": true|false, "evidence": string }... ], "confidence": number (0..1), "summary": string, "visual_verification": string }',
            '',
            `Завдання користувача: ${userMessage}`,
            `План Atlas: ${atlasPlan}`,
            `Звіт Тетяни: ${tetyanaReport}`,
            hasVisualEvidence ? visualEvidenceText : '\nВізуальні докази недоступні для цієї сесії.',
            '',
            'Валідаційні інструкції:',
            '- Перевіряй наявність артефактів, вміст файлів, коректність шляхів, результати команд.',
            '- Порівняй звіт Тетяни з візуальними доказами (якщо доступні).',
            '- Для кожного критерію надай конкретний доказ (evidence), включаючи візуальну верифікацію.',
            '- У полі visual_verification опиши, як візуальні докази підтверджують або спростовують звіт.',
            '- Оціни загальну впевненість у діапазоні 0..1.'
        ].join('\n');

    const grishaSys = `Ти — Гриша, валідаційний агент. Виконуй перевірки інструментально ТА візуально. ПОВЕРТАЙ СТРОГО JSON: { "criteria": [ { "name": string, "result": true|false, "evidence": string } ], "confidence": number, "summary": string, "visual_verification": string }`;
    const gooseOut = await runExecution(verifyPrompt, verifySession, { enableTools: true, systemInstruction: grishaSys });
        const parsed = extractJson(gooseOut);
        if (parsed && typeof parsed === 'object') {
            lastResult = parsed;
            confidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
            notes.push(`iter${iteration}: conf=${confidence}`);
            if (confidence >= GRISHA_CONFIDENCE_THRESHOLD) break;
            // Refine: ask to focus on failed criteria only
            const failed = (parsed.criteria || []).filter(c => c && c.result === false).map(c => c.name).join(', ');
            if (failed) {
                const refinePrompt = [
                    'Попередня валідація недостатня. Посилити перевірку по провалених критеріях:',
                    failed,
                    'ПОВЕРНИ ЛИШЕ JSON у тому ж форматі, підтверджуючи або спростовуючи.'
                ].join('\n');
                const refine = await runExecution(refinePrompt, verifySession, { enableTools: true, systemInstruction: grishaSys });
                const refParsed = extractJson(refine);
                if (refParsed && typeof refParsed === 'object' && typeof refParsed.confidence === 'number') {
                    lastResult = refParsed;
                    confidence = refParsed.confidence;
                }
            }
        } else {
            // Could not parse JSON; treat as low confidence and break to avoid loop
            lastResult = { 
                criteria: [], 
                confidence: 0, 
                summary: 'Неможливо розібрати відповідь Goose.',
                visual_verification: hasVisualEvidence ? 'Візуальні докази були доступні, але відповідь не розпізнана.' : 'Візуальні докази недоступні.'
            };
            confidence = 0;
            break;
        }
    }
    // Ensure we stop visual monitoring if we started it here (best-effort)
    try {
        if (monitoringStarted) {
            const stopRes = await stopGrishaVisualMonitoring();
            if (stopRes && stopRes.success) console.log(`[GRISHA] Visual monitoring stopped for verification session ${verifySession}`);
        }
    } catch (e) {
        console.warn(`[GRISHA] Error stopping visual monitoring: ${e.message}`);
    }

    return { result: lastResult, confidence, iterations: iteration, notes };
}

// SSE endpoint for real-time streaming
app.get('/chat/stream/:sessionId', (req, res) => {
    const sessionId = req.params.sessionId;
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    const keepAlive = setInterval(() => {
        res.write('data: {"type":"keepalive"}\n\n');
    }, 30000);

    req.on('close', () => {
        clearInterval(keepAlive);
        logMessage('info', `SSE connection closed for session ${sessionId}`);
    });

    res.write('data: {"type":"connected","sessionId":"' + sessionId + '"}\n\n');
});

// Start server
if (process.env.NODE_ENV !== 'test') {
    let retryCount = 0;
    const maxRetries = 3;
    
    function startServer() {
        const server = app.listen(PORT, '0.0.0.0', () => {
            logMessage('info', `ATLAS Orchestrator running on port ${PORT}`);
            logMessage('info', 'Agent system initialized with TTS integration');
        });
        
        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                retryCount++;
                if (retryCount <= maxRetries) {
                    logMessage('error', `Port ${PORT} is busy. Retry ${retryCount}/${maxRetries} in 2 seconds...`);
                    setTimeout(() => {
                        startServer();
                    }, 2000);
                } else {
                    logMessage('error', `Failed to start server after ${maxRetries} retries. Port ${PORT} is permanently busy.`);
                    process.exit(1);
                }
            } else {
                logMessage('error', `Server error: ${err.message}`);
                process.exit(1);
            }
        });
    }
    
    startServer();
}

export default app;

// ------------------------------------------------------------
// Fallback: enforceTetianaStructure (previously missing -> 500)
// Ensures Tetyana output always has required sections.
// If already looks structured, return as-is.
// ------------------------------------------------------------
function enforceTetianaStructure(raw) {
    try {
        if (!raw || typeof raw !== 'string') return '[ТЕТЯНА] РЕЗЮМЕ: (порожньо)\nСТАТУС: Needs Clarification — надати зміст.';
        const hasResume = /РЕЗЮМЕ:/i.test(raw);
        const hasSteps = /(КРОКИ:|1\.|•)/i.test(raw);
        const hasResults = /РЕЗУЛЬТАТИ:/i.test(raw);
        const hasEvidence = /ДОКАЗИ:/i.test(raw);
        const hasCheck = /ПЕРЕВІРКА:/i.test(raw);
        const hasStatus = /СТАТУС:/i.test(raw);
        const structured = hasResume && hasSteps && hasResults && hasEvidence && hasCheck && hasStatus;
        if (structured) return raw;
        const sections = [];
        if (!hasResume) sections.push('РЕЗЮМЕ: —');
        if (!hasSteps) sections.push('КРОКИ:\n1. —');
        if (!hasResults) sections.push('РЕЗУЛЬТАТИ:\n• —');
        if (!hasEvidence) sections.push('ДОКАЗИ:\n• критерій -> доказ');
        if (!hasCheck) sections.push('ПЕРЕВІРКА: —');
        if (!hasStatus) sections.push('СТАТУС: Needs Clarification — доповнити відсутні частини.');
        return `${raw}\n\n${sections.join('\n')}`;
    } catch (e) {
        return `[ТЕТЯНА] РЕЗЮМЕ: (internal struct error: ${e.message})\nСТАТУС: Blocked`;
    }
}

// ------------------------------------------------------------
// Clarification Auto-Fill (post-export to avoid hoist confusion)
// ------------------------------------------------------------
// When a clarification is requested and the user stays silent for 30s,
// Atlas will inject a synthetic "assumed clarification" message to unblock the pipeline.
// Requirements:
//  - 30s timeout after entering clarification state
//  - 10 rotating variants (cyclic)
//  - After auto-fill: force new actionable cycle (Atlas -> Grisha -> Tetyana)
//  - Cancel timer if user replies earlier (handled where awaitingClarification is cleared)
//  - Avoid multiple concurrent timers per session

const CLAR_AUTOFILL_VARIANTS = [
    'Олег Миколайович, припускаю що мета стандартна: отримати робочий результат за мінімальними ресурсами. Продовжую на базових припущеннях.',
    'Схоже ви зайняті. Я беру ініціативу: середовище macOS, можна створювати тимчасові файли, зовнішніх секретів немає.',
    'Не отримав деталей — стартую з гіпотези: ціль — короткий відтворюваний прототип + звіт з доказами.',
    'Авто-делегація: дозволені базові CLI і Python пакети з requirements.txt. Якщо треба інше — напишете пізніше.',
    'Приймаю рішення рухатись далі: критерієм успіху буде звіт + артефакти (файли / логи).',
    'Оскільки відповіді немає — моделюю початковий стан як «чистий робочий каталог без специфічних конфіг».',
    'Запускаю виконання із стандартними security-обмеженнями (без видалення критичних шляхів).',
    'Беру на себе уточнення: час на перший корисний результат < 2 хв, далі ітеративне покращення.',
    'Відсутність відповіді трактую як згоду на автономне продовження. Формую план і переходжу до реалізації.',
    'Просканую контекст і використаю типові патерни. Якщо зʼявляться контр-вказівки — перебудую.',
    'Делеговано мовчазно: активую стандартний набір припущень (середовище, інструменти, критерії).',
    'Автоматичне уточнення: очікуваний вихід — структурований звіт + докази виконання.',
    'Не бачу реакції — беру гіпотезу що потрібна максимальна прозорість кроків. Додаю перевірки.',
    'Відсутність уточнень => вважаю що немає прихованих ліцензійних обмежень чи приватних моделей.',
    'Я ініціюю самостійне формування уточнень: якщо пізніше уточните — адаптую без перезапуску.',
    'Перехожу до плану: мінімізую ризики, фіксую кожен ключовий артефакт.',
    'Розцінюю паузу як делегування. Застосовую стандартні практики (логування / короткі цикли).',
    'Запускаю план без додаткових вводних. Можу призупинити, якщо зʼявиться ваша відповідь.',
    'Мовчання прийнято: обираю базову стратегію і переходжу до дій.',
    'Для уникнення простою — автозапуск: припускаю типові параметри. Уточнення можна надати в будь-який момент.'
];

function nextClarVariant(session) {
    session._clarVariantIndex = (session._clarVariantIndex || 0) % CLAR_AUTOFILL_VARIANTS.length;
    const v = CLAR_AUTOFILL_VARIANTS[session._clarVariantIndex];
    session._clarVariantIndex = (session._clarVariantIndex + 1) % CLAR_AUTOFILL_VARIANTS.length;
    return v;
}

function scheduleClarificationAutoFill(session) {
    try {
        if (!session || !session.awaitingClarification) { logMessage('debug','[clar_timer] skip schedule (no session or not awaiting)'); return; }
        if (session._clarTimer) { logMessage('debug', `[clar_timer] already scheduled sid=${session.id}`); return; }
        const TIMEOUT_MS = parseInt(process.env.ATLAS_CLAR_AUTOFILL_MS || '30000', 10);
        const baseHistoryLen = session.history.length;
        logMessage('info', `[clar_timer] scheduling auto-fill in ${TIMEOUT_MS}ms sid=${session.id} history=${baseHistoryLen}`);
        session._clarTimer = setTimeout(async () => {
            session._clarTimer = null;
            if (!session.awaitingClarification) { logMessage('info', `[clar_timer] cancelled (flag cleared) sid=${session.id}`); return; }
            try {
                logMessage('info', `[clar_timer] firing sid=${session.id} historyBefore=${session.history.length}`);
                const assumed = nextClarVariant(session);
                logMessage('debug', `[clar_timer] generated assumption: ${assumed.slice(0,150)}`);
                
                pushAndBroadcast(session, {
                    role: 'assistant',
                    agent: 'atlas',
                    content: `[AUTO-CLARIFICATION] ${assumed}`,
                    timestamp: Date.now(),
                    phase: 'atlas_auto_clarify',
                    autoClarification: true
                });
                logMessage('debug', `[clar_timer] atlas auto-clarification pushed, history length: ${session.history.length}`);
                
                pushAndBroadcast(session, {
                    role: 'user',
                    agent: 'user',
                    content: '[assumed_clarification] Автоматичне припущення: продовжити з типовими налаштуваннями.',
                    timestamp: Date.now(),
                    autoClarification: true,
                    assumed: true
                });
                logMessage('debug', `[clar_timer] user assumption pushed, history length: ${session.history.length}`);
                
                session.awaitingClarification = false;
                session.forceNewCycle = true;
                session.cycleCount = (session.cycleCount || 0) + 1;
                logMessage('debug', `[clar_timer] flags set, baseHistoryLen=${baseHistoryLen}, currentLength=${session.history.length}`);
                
                // Завжди робимо kickstart після auto-clarification
                logMessage('info', `[clar_timer] auto-continue kickstart sid=${session.id}`);
                try {
                    // Знаходимо попередні відповіді Atlas та Grisha для правильного kickstart
                    const lastAtlas = [...session.history].reverse().find(m => m.agent==='atlas' && (m.phase === 'atlas_plan' || m.phase === 'atlas_clarify'));
                    const lastGrisha = [...session.history].reverse().find(m => m.agent==='grisha' && m.phase === 'grisha_precheck');
                    const syntheticUser = '[AUTO] Продовжити виконання.';
                    
                    logMessage('info', `[clar_timer] kickstart with atlas="${lastAtlas?.content?.slice(0,100)}" grisha="${lastGrisha?.content?.slice(0,100)}"`);
                    startActionablePipeline(session, syntheticUser, lastAtlas?.content || '', lastGrisha?.content || '');
                    logMessage('info', `[clar_timer] kickstart completed successfully`);
                } catch(e){ logMessage('warn', `[clar_timer] kickstart failed: ${e.message}`); }
            } catch (e) {
                logMessage('warn', 'Clarification auto-fill failed: ' + e.message);
            }
        }, TIMEOUT_MS);
    } catch (e) {
        logMessage('warn', 'Clarification auto-fill scheduling failed: ' + e.message);
    }
}

// SSE subscribers (moved up to avoid temporal dead zone)
const historySubscribers = new Map(); // sessionId -> Set(res)

function sseInit(req, res) {
    const sessionId = req.params.sessionId;
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    let set = historySubscribers.get(sessionId);
    if (!set) { set = new Set(); historySubscribers.set(sessionId, set); }
    set.add(res);
    const session = sessions.get(sessionId);
    if (session) {
        const backlog = session.history.slice(-25).map(sanitizeMessageForClient);
        res.write('data: ' + JSON.stringify({ type: 'backlog', messages: backlog }) + '\n\n');
    } else {
        res.write('data: ' + JSON.stringify({ type: 'backlog', messages: [] }) + '\n\n');
    }
    res.write('data: ' + JSON.stringify({ type: 'connected', sessionId }) + '\n\n');
    if (process.env.DEBUG_SSE === '1') logMessage('info', `[sse] client connected history stream sid=${sessionId} total=${set.size}`);
    const heartbeat = setInterval(() => { try { res.write('data: {"type":"hb"}\n\n'); } catch { /* ignore */ } }, 25000);
    heartbeat.unref?.();
    req.on('close', () => {
        clearInterval(heartbeat);
        set.delete(res);
        if (process.env.DEBUG_SSE === '1') logMessage('info', `[sse] client disconnected sid=${sessionId} remaining=${set.size}`);
        if (!set.size) historySubscribers.delete(sessionId);
    });
}

function broadcastHistory(sessionId, payloadObj) {
    const set = historySubscribers.get(sessionId);
    if (!set || !set.size) return;
    const data = 'data: ' + JSON.stringify(payloadObj) + '\n\n';
    for (const res of set) {
        try { res.write(data); } catch { /* ignore broken pipe */ }
    }
}

// Wrap a push into session history so UI can receive without polling
function pushAndBroadcast(session, messageObj) {
    try {
        session.history.push(messageObj);
        logMessage('debug', `[pushAndBroadcast] pushed ${messageObj.agent}:${messageObj.phase||'no-phase'} content_len=${(messageObj.content||'').length}`);
        broadcastHistory(session.id, { type: 'message', message: sanitizeMessageForClient(messageObj) });
    } catch (e) {
        logMessage('warn', `[pushAndBroadcast] failed: ${e.message}`);
        throw e;
    }
}

function sanitizeMessageForClient(m) {
    // Remove heavy internals
    const { timing, ...rest } = m || {};
    return rest;
}

// Patch existing code paths gradually: monkey-patch session.history.push usage is risky; instead we incrementally adopt pushAndBroadcast where critical.
// (Future improvement: refactor to central addHistory(session, obj) helper.)

// GET full history (lightweight) — optional trimming via ?since=<ts>
app.get('/session/:sessionId/history', (req, res) => {
    const { sessionId } = req.params;
    const since = parseInt(req.query.since || '0', 10) || 0;
    const session = sessions.get(sessionId);
    if (!session) return res.json({ success: false, history: [] });
    const filtered = since ? session.history.filter(m => (m.timestamp||0) > since) : session.history;
    res.json({ success: true, history: filtered.map(sanitizeMessageForClient) });
});

// SSE stream for incremental history
app.get('/session/:sessionId/history/stream', (req,res) => { sseInit(req,res); });
