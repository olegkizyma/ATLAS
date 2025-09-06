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
import { PHASE, initSession, startActionablePipeline, markNeedsMore, clearPipeline, tagResponse, executionMode, shouldImmediateExecute } from './pipeline.js';
import gooseAdapter, { runExecution, extractEvidence } from './goose_adapter.js';

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
    mockExecutions: 0            // fallback simulated executions (if any)
};

const app = express();
const PORT = process.env.ORCH_PORT || 5101;
const GRISHA_CONFIDENCE_THRESHOLD = Math.max(0, Math.min(1, parseFloat(process.env.GRISHA_CONFIDENCE_THRESHOLD || '0.8')));
const GRISHA_MAX_VERIFY_ITER = Math.max(1, parseInt(process.env.GRISHA_MAX_VERIFY_ITER || '3', 10));

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
    const resp = await axios.post(url, payload, { headers, timeout: 20000 });
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

// Session state management
const sessions = new Map();
let messageCounter = 0;

// Helper functions
const generateMessageId = () => `msg_${Date.now()}_${++messageCounter}`;

const logMessage = (level, message) => {
    console.log(`[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`);
};


// Tetyana structured report helpers
function tetianaSystemInstruction({ enableTools } = { enableTools: false }) {
    const base = [
        'Ти — Тетяна, виконавиця. Відповідай СТИСЛО та ЧІТКО, лише факти і результати.',
        'ЗАВЖДИ ПОВЕРТАЙ структурований звіт за шаблоном нижче українською.',
        '',
        'Формат звіту:',
        '1) РЕЗЮМЕ (1-2 речення): коротко що зроблено і статус.',
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
    let out = String(text || '').trim();
    if (!out.startsWith('[ТЕТЯНА]')) {
        out = `[ТЕТЯНА] ${out}`;
    }
    const v = validateTetianaReport(out);
    if (v.ok) return out;
    const template = [
        out,
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
        'СТАТУС: Needs Clarification — доповнити відсутні частини: ' + v.missing.join(', ')
    ];
    return template.join('\n');
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

// -----------------------------
// Intent LRU cache (Phase 2 optional /intent endpoint)
// -----------------------------
const INTENT_CACHE_CAPACITY = 64;
const INTENT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const intentCache = new Map(); // key => { intent, ts }

function intentCacheGet(key) {
    const rec = intentCache.get(key);
    if (!rec) return null;
    if (Date.now() - rec.ts > INTENT_CACHE_TTL_MS) { intentCache.delete(key); return null; }
    return rec.intent;
}

function intentCacheSet(key, intent) {
    if (intentCache.has(key)) intentCache.delete(key); // refresh order
    intentCache.set(key, { intent, ts: Date.now() });
    while (intentCache.size > INTENT_CACHE_CAPACITY) {
        const oldestKey = intentCache.keys().next().value;
        intentCache.delete(oldestKey);
    }
}

async function classifyIntentWithRouter(text, atlasContext) {
    // If external INTENT_ROUTER enabled (future hook), try it; otherwise fallback to smart classifier
    if (process.env.INTENT_ROUTER === '1') {
        try {
            const url = (process.env.INTENT_ROUTER_URL || '').trim();
            if (url) {
                const resp = await axios.post(url, { text, atlas: atlasContext }, { timeout: 1200, validateStatus: () => true });
                const maybe = String(resp.data?.intent || '').toLowerCase();
                if (['actionable','planning','qa','smalltalk'].includes(maybe)) return maybe;
            }
        } catch (_) { /* swallow and fallback */ }
    }
    return await classifyIntentSmart(text, atlasContext || '');
}

async function getIntentCached(text, atlasContext) {
    const key = text.trim().toLowerCase();
    const cached = intentCacheGet(key);
    if (cached) return { intent: cached, cached: true };
    const intent = await classifyIntentWithRouter(text, atlasContext);
    intentCacheSet(key, intent);
    return { intent, cached: false };
}

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/agents', (req, res) => {
    res.json(AGENTS);
});

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

// Main chat processing endpoint
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
        const gooseExec = await callGooseAgent(message, sessionId, { enableTools: true, systemInstruction: sys });
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
    const { message, sessionId, userId } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    logMessage('info', `Incoming /chat/stream message (session=${sessionId || 'n/a'}): ${String(message).slice(0, 200)}`);

    const session = sessions.get(sessionId) || { 
        id: sessionId,
        history: [],
        currentAgent: 'atlas',
        lastInteraction: Date.now()
    };
    sessions.set(sessionId, session);

    // Check for user commands
    const messageText = message.toLowerCase().trim();
    
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
                nextAction: session.nextAction || null
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

    // Phase 1: Atlas creates primary reply/plan (use heuristic intent to bias model choice)
    const preIntent = classifyIntentHeuristic(userMessage, '');
    const atlasResponseRaw = await generateAgentResponse('atlas', userMessage, session, { intentHint: preIntent });
    const atlasResponse = tagResponse(atlasResponseRaw, PHASE.ATLAS_PLAN);
    responses.push(atlasResponse);
    session.history.push(atlasResponse);

    // Classify user intent to route the flow efficiently (LLM-first with fallback)
    const intent = await classifyIntentSmart(userMessage, atlasResponse.content || '');
    session.intent = intent;
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

        startActionablePipeline(session, userMessage, atlasResponse.content, grishaPre.content);

        // Immediate mode: execute right away without waiting for frontend continuation
        if (shouldImmediateExecute(intent)) {
            PIPELINE_METRICS.immediateExecutions++;
            const execPrompt = `Завдання користувача: ${userMessage}\nПлан Atlas: ${atlasResponse.content}\nВимоги Гриші: ${grishaPre.content}\n\nВиконай кроки та чітко звітуй.`;
            const tetyanaExecRaw = await generateAgentResponse('tetyana', execPrompt, session, { enableTools: true });
            const tetyanaExec = tagResponse(tetyanaExecRaw, PHASE.EXECUTION);
            try { tetyanaExec.evidence = extractEvidence(tetyanaExec.content); } catch {}
            responses.push(tetyanaExec);
            session.history.push(tetyanaExec);
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
            if (!confirmed) {
                const missing = (verify.result?.criteria || []).filter(c => c && c.result === false).map(c => c.name);
                const ask = `Потрібно надати додаткові докази по: ${missing.join(', ') || 'не визначено'}. Надати конкретні шляхи/вміст/виходи команд.`;
                const grishaFollowRaw = await generateAgentResponse('grisha', ask, session);
                const grishaFollow = tagResponse(grishaFollowRaw, PHASE.GRISHA_FOLLOWUP);
                PIPELINE_METRICS.followups++;
                responses.push(grishaFollow);
                session.history.push(grishaFollow);
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

        try {
            logMessage('debug', 'Returning actionable responses phases=' + responses.map(r => r.phase).join(','));
        } catch {}
        return responses;
    if (intent === 'planning' && shouldTriggerDiscussion(atlasResponse.content)) {
    const grishaRespRaw = await generateAgentResponse('grisha', atlasResponse.content, session);
    const grishaResponse = tagResponse(grishaRespRaw, PHASE.GRISHA_PRECHECK);
    responses.push(grishaResponse);
    session.history.push(grishaResponse);

    try {
        logMessage('debug', 'Returning non-actionable responses phases=' + responses.map(r => r.phase).join(','));
    } catch {}
    return responses;
        if (detectDisagreement([atlasResponse, grishaResponse])) {
            dialogueManager.startDiscussion('Task execution approach', ['atlas', 'grisha', 'tetyana']);
        }
    }

    return responses;
}

// Lightweight intent classifier for routing
// Returns: 'actionable' | 'planning' | 'qa' | 'smalltalk'
function classifyIntentHeuristic(userText, atlasText) {
    const t = String(userText || '').toLowerCase();
    const a = String(atlasText || '').toLowerCase();

    // Actionable if explicit commands present
    if (isActionableTask(t)) return 'actionable';

    // Small talk
    const smallTalkRe = /(привіт|вітаю|добр(ий|ого)|хай|як справи|дякую|будь ласка|гарного дня|на добраніч|салют|hello|hi|thanks|thank you)/i;
    if (smallTalkRe.test(t)) return 'smalltalk';

    // Q&A indicators
    const qaRe = /(\?|що таке|як зробити|як налаштувати|поясни|explain|how to|why|що робити)/i;
    if (qaRe.test(t)) return 'qa';

    // Planning if plan/strategy is the focus without direct action
    const planningRe = /(план|стратегія|кроки|етапи|ризик|безпека)/i;
    if (planningRe.test(a) || planningRe.test(t)) return 'planning';

    // Default fallback
    return /(^що\b|^як\b|^чому\b)/i.test(t) ? 'qa' : 'smalltalk';
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
            try { tetyanaExec.evidence = extractEvidence(tetyanaExec.content); } catch {}
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

// Expose pipeline metrics (ephemeral, resets on restart)
app.get('/metrics/pipeline', (req, res) => {
    try {
        const avgConfidence = PIPELINE_METRICS.verdicts > 0 ? (PIPELINE_METRICS.verificationConfidenceSum / PIPELINE_METRICS.verdicts) : 0;
        const avgVerificationIterations = PIPELINE_METRICS.verdicts > 0 ? (PIPELINE_METRICS.verificationIterations / PIPELINE_METRICS.verdicts) : 0;
        // Provider circuit breaker snapshot
        const state = registry.getState();
        const providers = Object.values(state.providers).map(p => ({
            name: p.name,
            healthy: p.healthy,
            consecutiveFailures: p.consecutiveFailures,
            failuresTotal: p.failuresTotal || 0,
            cooldownRemainingMs: p.cooldownUntil && Date.now() < p.cooldownUntil ? (p.cooldownUntil - Date.now()) : 0
        }));
        return res.json({
            success: true,
            metrics: {
                ...PIPELINE_METRICS,
                avgConfidence: Number(avgConfidence.toFixed(3)),
                avgVerificationIterations: Number(avgVerificationIterations.toFixed(2)),
                providers
            },
            timestamp: Date.now()
        });
    } catch (e) {
        return res.status(500).json({ error: 'failed_to_collect_metrics', details: e.message });
    }
});

// Heuristics: detect actionable tasks that require an executor (Tetyana)
function isActionableTask(text) {
    const t = (text || '').toLowerCase();
    const verbs = [
        'відкрий', 'запусти', 'виконай', 'виконати', 'обчисли', 'порахуй', 'корінь', 'sqrt',
        'збережи', 'зберегти', 'створи', 'створити', 'на пк', 'на робочому столі', 'на робочий стіл',
    'відкрий калькулятор', 'калькулятор', 'редактор', 'текстовий файл', 'txt',
    // хенд-оф/верифікація
    'передай тетяні', 'передати тетяні', 'для тетяни', 'тетяна',
    'передай гріші', 'передати гріші', 'для гриші', 'гриша', 'перевірку', 'перевірити'
    ];
    return verbs.some(v => t.includes(v));
}

// Legacy static plan removed: dynamic routing handled by ModelRegistry

// Real agent integration
async function generateAgentResponse(agentName, inputMessage, session, options = {}) {
    const agent = AGENTS[agentName];
    const messageId = generateMessageId();
    
    // Create role-based prompt
    let prompt = createAgentPrompt(agentName, inputMessage, session);
    
    let content;
    let provider = undefined;
    let model = undefined;
    
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
            if (agentName === 'atlas') {
                content = 'План тимчасово недоступний через провайдерів. Мінімальний fallback: сформулюйте кроки: 1) Аналіз 2) Виконання 3) Перевірка.';
            } else if (agentName === 'grisha') {
                content = 'Валідація не виконана (fallback). Потрібні докази: файл(и), результат команди, підтвердження стану.';
            } else {
                content = 'Резервна відповідь агента.';
            }
        }
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
    
    switch (agentName) {
        case 'atlas':
            return `${baseContext} Ти — ATLAS, стратег. Твоє завдання: швидко перефразувати запит користувача українською зрозумілою мовою, окреслити суть і контекст, виділити ключові вимоги і ризики. Без детальної нумерації кроків — це робота Тетяни. Якщо бракує даних, сформулюй 1–2 точні питання до користувача або до Тетяни.

Запит користувача: ${message}
Нещодавній контекст: ${getRecentHistory(session, 3)}

Стиль: стисло, по суті, дружньо, з легкими живими зверненнями за потреби (без заучених фраз).`;

        case 'grisha':
            return `${baseContext} Ти — Гриша, валідаційний агент. Перша перевірка — одразу після перефразування від ATLAS: оцінка ризиків і безпеки, вкажи на слабкі місця. Друга перевірка — після звіту Тетяни: валідуй, що завдання справді виконано за критеріями. Якщо не виконано — чітко вкажи, що саме не так, і які докази потрібні.

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
function shouldTriggerDiscussion(message) {
    const discussionTriggers = ['план', 'стратегія', 'безпека', 'ризик', 'проблема'];
    return discussionTriggers.some(trigger => message.toLowerCase().includes(trigger));
}

function detectDisagreement(responses) {
    const disagreementWords = ['не згоден', 'проти', 'ризикo', 'небезпечно', 'неправильно'];
    return responses.some(response => 
        disagreementWords.some(word => response.content.toLowerCase().includes(word))
    );
}

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
    // Try to extract the last JSON object from text
    const s = String(text || '');
    const start = s.lastIndexOf('{');
    const end = s.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
        try { return JSON.parse(s.slice(start, end + 1)); } catch (_) {}
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