/**
 * ATLAS 3-Agent System Orchestrator
 * Manages communication between Atlas, Tetiana, and Grisha agents
 * Integrates with TTS system for real-time dialogue
 */
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

async function callOpenAICompatChat(baseUrl, model, userMessage) {
    const url = `${baseUrl}/chat/completions`;
    const payload = {
        model,
        messages: [ { role: 'user', content: userMessage } ],
        stream: false
    };
    const apiKey = process.env.OPENAI_COMPAT_API_KEY || process.env.FALLBACK_API_KEY || '';
    const headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'X-API-Key': apiKey } : {})
    };
    // Increase timeout for local LLMs which may be slower; 120s default
    const resp = await axios.post(url, payload, { headers, timeout: parseInt(process.env.OPENAI_COMPAT_TIMEOUT_MS || '120000', 10) });
    if (resp.status !== 200) throw new Error(`OpenAI-compat HTTP ${resp.status}`);
    const text = resp.data?.choices?.[0]?.message?.content;
    return (typeof text === 'string' && text.trim()) ? text.trim() : null;
}

async function callOpenAICompatChatWithTimeout(baseUrl, model, userMessage, timeoutMs = 1500) {
    const url = `${baseUrl}/chat/completions`;
    const payload = {
        model,
        messages: [ { role: 'user', content: userMessage } ],
        stream: false
    };
    const apiKey = process.env.OPENAI_COMPAT_API_KEY || process.env.FALLBACK_API_KEY || '';
    const headers = {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}`, 'X-API-Key': apiKey } : {})
    };
    const resp = await axios.post(url, payload, { headers, timeout: timeoutMs });
    if (resp.status !== 200) throw new Error(`OpenAI-compat HTTP ${resp.status}`);
    const text = resp.data?.choices?.[0]?.message?.content;
    return (typeof text === 'string' && text.trim()) ? text.trim() : null;
}

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

const logMessage = (level, message) => {
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
};

function logProbe(message) {
    console.log(`[${new Date().toISOString()}] [PROBE] ${message}`);
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
        base.push('Якщо потрібно — використовуй доступні інструменти/дії (файли/OS/додатки). Віддавай перевагу реальному виконанню, а не симуляції.');
    }
    return base.join('\n');
}

function isVagueTetianaResponse(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return true;
    const generic = ['завдання опрацьовано', 'завдання виконано', 'готово', 'готовий', 'готова'];
    return generic.some(g => t === g || t.startsWith(g));
}

function validateTetianaReport(text) {
    const t = String(text || '');
    const hasResume = /\bРЕЗЮМЕ\b/i.test(t);
    const hasSteps = /\bКРОКИ\b/i.test(t);
    const hasResults = /\bРЕЗУЛЬТАТИ\b/i.test(t);
    const hasEvidence = /\bДОКАЗИ\b/i.test(t) || /criterion\s*->\s*evidence/i.test(t);
    const hasVerification = /\bПЕРЕВІРКА\b/i.test(t);
    const hasStatus = /\bСТАТУС\b/i.test(t);
    const missing = [];
    if (!hasResume) missing.push('РЕЗЮМЕ');
    if (!hasSteps) missing.push('КРОКИ');
    if (!hasResults) missing.push('РЕЗУЛЬТАТИ');
    if (!hasEvidence) missing.push('ДОКАЗИ');
    if (!hasVerification) missing.push('ПЕРЕВІРКА');
    if (!hasStatus) missing.push('СТАТУС');
    return { ok: missing.length === 0, missing };
}

function enforceTetianaStructure(text) {
    let raw = String(text || '').trim();
    if (!raw.startsWith('[ТЕТЯНА]')) raw = `[ТЕТЯНА] ${raw}`;
    const v = validateTetianaReport(raw);

    // Detect placeholder / empty style content
    const placeholderPatterns = [
        /критерій\s*:\s*…/i,
        /РЕЗЮМЕ:\s*—/i,
        /ПЕРЕВІРКА:\s*—/i,
        /СТАТУС:\s*Needs Clarification/i
    ];
    const onlyBullets = raw.split('\n').filter(l => l.trim()).every(l => /^(?:\[ТЕТЯНА]|РЕЗЮМЕ|КРОКИ|РЕЗУЛЬТАТИ|ДОКАЗИ|ПЕРЕВІРКА|СТАТУС|[0-9]+\.|•|критерій)/i.test(l.trim()));
    const isPlaceholder = placeholderPatterns.some(r => r.test(raw)) || raw.length < 120 || onlyBullets;

    if (v.ok && !isPlaceholder) return raw;

    // Append diagnostic marker for Grisha to treat as non-evidence
    const missingNote = v.ok ? 'PLACEHOLDER_CONTENT' : ('Missing sections: ' + v.missing.join(', '));
    const template = [
        raw,
        '',
        'РЕЗЮМЕ: —',
        'КРОКИ:',
        '1.',
        '2.',
        'РЕЗУЛЬТАТИ:',
        '•',
        'ДОКАЗИ (criterion -> evidence):',
        '• критерій: … -> доказ: …',
        'ПЕРЕВІРКА: —',
        `СТАТУС: Needs Clarification — доповнити відсутні частини: ${v.missing.join(', ') || 'зміст/докази'}`,
        `<!-- TETYANA_REPORT_DIAGNOSTIC: ${missingNote} -->`
    ];
    return template.join('\n');
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
        // TTL prune
        const cutoff = NOW - TTL_MS;
        for (const [k, meta] of cache.map.entries()) {
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

    if (clientMessageId) {
        const key = `${sid}::${clientMessageId}`;
        if (cache.map.has(key)) {
            // Duplicate → миттєва відповідь без повторної обробки
            return res.json({ success: true, duplicate: true, response: [], session: { id: sid, currentAgent: 'atlas' } });
        }
        cache.map.set(key, { ts: NOW, sessionId: sid });
        touch(key);
    }

    logMessage('info', `Incoming /chat/stream message (session=${sid} cmsg=${clientMessageId || 'no-id'}): ${String(message).slice(0, 200)}`);

    // Проміжний ACK (offload/accepted) — клієнт може показати статус «Обробка...».
    if (req.headers['x-atlas-ack'] === 'immediate') {
        return res.json({ success: true, accepted: true, session: { id: sid }, message: 'accepted' });
    }

    const session = sessions.get(sessionId) || { 
        id: sessionId,
        history: [],
        currentAgent: 'atlas',
        lastInteraction: Date.now()
    };
    sessions.set(sessionId, session);

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
        
    // Автозакриття тільки якщо немає пайплайну/наступної дії і це НЕ smalltalk
    const ended = !session.pipeline && !session.nextAction && session.intent !== 'smalltalk';

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
            endOfConversation: ended === true
        });

    } catch (error) {
        logMessage('error', `Chat processing failed: ${error.message}`);
        res.status(500).json({
            error: 'Processing failed',
            details: error.message
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
            const shortage = /(уточн|потрібн[аоі]|недостатньо|вкажіть|які саме|provide|missing|need (more|additional))/i.test(lowerGrisha);
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
                session.awaitingClarification = true;
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
            const verdictMsg = confirmed
                ? `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО виконаним.`
                : `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів. Посилити перевірку.`;
            const grishaVerdictRaw = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            const grishaVerdict = tagResponse(grishaVerdictRaw, PHASE.GRISHA_VERDICT);
            grishaVerdict.verification = { confidence: verify.confidence, confirmed };
            grishaVerdict.evidence = (verify.result?.criteria || []).map(c => ({ name: c.name, result: c.result, evidence: c.evidence }));
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
                session.awaitingClarification = true;
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
    return responses;
}

// Lightweight intent classifier for routing
// Returns: 'actionable' | 'planning' | 'qa' | 'smalltalk'
function classifyIntentHeuristic(_userText, _atlasText) {
    // Heuristic intent removed: default neutral fallback (planning)
    return 'planning';
}

// LLM-based intent classification via openai_compat (3010) with fallback to heuristic
async function classifyIntentSmart(userText, atlasText) {
    try {
        const routes = (registry.getRoutes('atlas') || []).filter(r => r.provider === 'openai_compat');
        const prompt = [
            'Класифікуй намір користувача в одну категорію: actionable | planning | qa | smalltalk.',
            'Формат відповіді: тільки одне слово з цього списку. Без пояснень, без лапок.',
            '',
            `Повідомлення: ${String(userText || '').slice(0, 2000)}`
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
            const verdictMsg = confirmed
                ? `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО виконаним.`
                : `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів. Посилити перевірку.`;
            const grishaVerdictRaw = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            const grishaVerdict = tagResponse(grishaVerdictRaw, PHASE.GRISHA_VERDICT);
            grishaVerdict.verification = { confidence: verify.confidence, confirmed };
            grishaVerdict.evidence = (verify.result?.criteria || []).map(c => ({ name: c.name, result: c.result, evidence: c.evidence }));
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
            const verdictMsg = confirmed
                ? `Незалежна повторна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО.`
                : `Незалежна повторна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів.`;
            const grishaVerdictRaw = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            const grishaVerdict = tagResponse(grishaVerdictRaw, PHASE.GRISHA_VERDICT);
            grishaVerdict.verification = { confidence: verify.confidence, confirmed };
            grishaVerdict.evidence = (verify.result?.criteria || []).map(c => ({ name: c.name, result: c.result, evidence: c.evidence }));
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

    // Для етапів пайплайну (actionable) залишаємо стандартне завершення, smalltalk тут не проходить
    const ended = !session.pipeline && !session.nextAction;

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
    const agent = AGENTS[agentName];
    const messageId = generateMessageId();
    
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
            timestamp: new Date().toISOString()
        };
    }
    
    // Create role-based prompt
    let prompt = createAgentPrompt(agentName, inputMessage, session);
    
    let content;
    let provider = undefined;
    let model = undefined;
    let executionSuccessful = false;
    
    if (agentName === 'tetyana') {
        // Execution via Goose only (no provider fallbacks for execution)
        const execNotes = await runExecution(prompt, session.id, {
            enableTools: options.enableTools === true,
            systemInstruction: tetianaSystemInstruction({ enableTools: options.enableTools === true })
        });

        if (!execNotes) {
            // Execution failed -> return blocked status without switching providers
            const blocked = 'РЕЗЮМЕ: Виконання недоступне (Goose недоступний).\nСТАТУС: Blocked — повторити пізніше або перевірити підключення.';
            content = enforceTetianaStructure(blocked);
            provider = 'goose';
            model = 'github_copilot';
            recordCircuitBreakerFailure();
        } else {
            // Short structured report via openai-compat using configured 58-model list
            const reportRoutes = (registry.getRoutes('tetyana', { intentHint: 'short_report' }) || []).filter(r => r.provider === 'openai_compat');
            const reportPrompt = [
                'Сформуй короткий структурований ЗВІТ українською на основі виконання нижче. Формат: РЕЗЮМЕ; КРОКИ; РЕЗУЛЬТАТИ; ДОКАЗИ; ПЕРЕВІРКА; СТАТУС.',
                `Виконання (сирий вивід): ${String(execNotes).slice(0, 6000)}`
            ].join('\n');
            let reportText = null;
            for (const route of reportRoutes) {
                try {
                    const started = Date.now();
                    const txt = await callOpenAICompatChat(route.baseUrl || FALLBACK_API_BASE, route.model, reportPrompt);
                    if (txt) {
                        reportText = txt;
                        registry.reportSuccess(route, Date.now() - started);
                        provider = 'openai_compat';
                        model = route.model;
                        executionSuccessful = true;
                        break;
                    }
                    registry.reportFailure(route);
                } catch (_) {
                    registry.reportFailure(route);
                }
            }
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
            const started = Date.now();
            try {
                if (route.provider === 'goose') {
                    const gooseText = await runExecution(prompt, session.id, { enableTools: false, systemInstruction: sysInstr });
                    if (gooseText) {
                        content = gooseText;
                        provider = 'goose';
                        model = route.model || 'github_copilot';
                        registry.reportSuccess(route, Date.now() - started);
                        executionSuccessful = true;
                        break;
                    }
                    registry.reportFailure(route);
                } else if (route.provider === 'openai_compat') {
                    const text = await callOpenAICompatChat(route.baseUrl || FALLBACK_API_BASE, route.model, prompt);
                    if (text) {
                        content = text;
                        provider = 'openai_compat';
                        model = route.model;
                        registry.reportSuccess(route, Date.now() - started);
                        executionSuccessful = true;
                        break;
                    }
                    registry.reportFailure(route);
                }
            } catch (err) {
                registry.reportFailure(route);
                // keep trying next route
            }
        }

        if (!content) {
            // Deterministic minimal fallback (single structured notice)
            PIPELINE_METRICS.mockExecutions++;
            recordCircuitBreakerFailure();
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
    
    return {
        role: 'assistant',
        content: `${agent.signature} ${content.replace(/^\[ТЕТЯНА\]\s*/i, '')}`,
        agent: agentName,
        messageId: messageId,
        timestamp: Date.now(),
        voice: agent.voice,
        color: agent.color,
        provider,
        model
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

    while (iteration < GRISHA_MAX_VERIFY_ITER) {
        iteration++;
        const verifyPrompt = [
            'Ти — Гриша, незалежний валідаційний агент. Твоє завдання — ПЕРЕВІРИТИ твердження Тетяни незалежно, використовуючи доступ до системи (файли/OS/додатки).',
            'Працюй акуратно, виконуй перевірки інструментами, якщо потрібно.',
            'Поверни РІВНО JSON з полями:',
            '{ "criteria": [ { "name": string, "result": true|false, "evidence": string }... ], "confidence": number (0..1), "summary": string }',
            '',
            `Завдання користувача: ${userMessage}`,
            `План Atlas: ${atlasPlan}`,
            `Звіт Тетяни: ${tetyanaReport}`,
            '',
            'Валідаційні інструкції:',
            '- Перевіряй наявність артефактів, вміст файлів, коректність шляхів, результати команд.',
            '- Для кожного критерію надай конкретний доказ (evidence), напр. абсолютний шлях, фрагмент вмісту, вихід команди).',
            '- Оціни загальну впевненість у діапазоні 0..1.'
        ].join('\n');

    const grishaSys = 'Ти — Гриша, валідаційний агент. Виконуй перевірки інструментально. ПОВЕРТАЙ СТРОГО JSON: { "criteria": [ { "name": string, "result": true|false, "evidence": string } ], "confidence": number, "summary": string }';
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
            lastResult = { criteria: [], confidence: 0, summary: 'Неможливо розібрати відповідь Goose.' };
            confidence = 0;
            break;
        }
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