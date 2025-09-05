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
    const headers = { 'Content-Type': 'application/json' };
    const resp = await axios.post(url, payload, { headers, timeout: 20000 });
    if (resp.status !== 200) throw new Error(`OpenAI-compat HTTP ${resp.status}`);
    const text = resp.data?.choices?.[0]?.message?.content;
    return (typeof text === 'string' && text.trim()) ? text.trim() : null;
}

if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, () => {
        logMessage('info', `ATLAS Orchestrator running on port ${PORT}`);
    });
}
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

// Routes
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/agents', (req, res) => {
    res.json(AGENTS);
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

        // Tetiana strictly uses Goose
        const gooseContent = await callGooseAgent(message, sessionId);
        if (!gooseContent) {
            return res.status(502).json({ error: 'Goose is unavailable for Tetiana' });
        }

        const msg = {
            role: 'assistant',
            content: `[ТЕТЯНА] ${gooseContent}`,
            agent: 'tetyana',
            messageId: generateMessageId(),
            timestamp: Date.now(),
            voice: 'tetiana',
            color: '#00ffff',
            provider: 'goose',
            model: 'github_copilot'
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
        
        res.json({
            success: true,
            response: response,
            session: {
                id: sessionId,
                currentAgent: session.currentAgent,
                requiresUserCommand: dialogueManager.requiresUserCommand(),
                nextAction: session.nextAction || null
            }
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
            response: response,
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
    
    // Add user message to history
    session.history.push({
        role: 'user',
        content: userMessage,
        timestamp: Date.now()
    });

    // Phase 1: Atlas creates plan
    const atlasResponse = await generateAgentResponse('atlas', userMessage, session);
    responses.push(atlasResponse);
    session.history.push(atlasResponse);

    // If message looks actionable (OS/app/file commands) -> staged pipeline with TTS pacing
    if (isActionableTask(userMessage)) {
        // 1) Grisha precheck now; execution deferred until frontend TTS completes
        const precheckPrompt = [
            'Ти — Гриша. Перед виконанням склади короткий план перевірки і визнач 1-3 точкові дії для Тетяни, які дадуть перевіряємі артефакти.',
            'Відповідай стисло: СПИСОК «ДЛЯ ТЕТЯНИ», де кожен пункт — конкретне завдання з очікуваним артефактом.',
            '',
            `Завдання користувача: ${userMessage}`,
            `План Atlas: ${atlasResponse.content}`
        ].join('\n');
        const grishaPre = await generateAgentResponse('grisha', precheckPrompt, session);
        responses.push(grishaPre);
        session.history.push(grishaPre);

        // Save pipeline state and instruct frontend to call /chat/continue after TTS
        session.pipeline = {
            type: 'actionable',
            stage: 'prechecked',
            userMessage,
            atlasPlan: atlasResponse.content,
            grishaPre: grishaPre.content,
            iter: 0
        };
        session.nextAction = 'tetyana_execute';
        return responses;
    }

    // Phase 2: Grisha reviews plan (if discussion required)
    if (shouldTriggerDiscussion(atlasResponse.content)) {
        const grishaResponse = await generateAgentResponse('grisha', atlasResponse.content, session);
        responses.push(grishaResponse);
        session.history.push(grishaResponse);

        // Phase 3: Tetiana provides input
        const tetyanaResponse = await generateAgentResponse('tetyana', 
            `Atlas plan: ${atlasResponse.content}\nGrisha review: ${grishaResponse.content}`, session);
        responses.push(tetyanaResponse);
        session.history.push(tetyanaResponse);

        // Start discussion if there's disagreement
        if (detectDisagreement([atlasResponse, grishaResponse, tetyanaResponse])) {
            dialogueManager.startDiscussion('Task execution approach', ['atlas', 'grisha', 'tetyana']);
        }
    }

    return responses;
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
            const tetyanaExec = await generateAgentResponse('tetyana', execPrompt, session, { enableTools: true });
            responses.push(tetyanaExec);
            session.history.push(tetyanaExec);

            // Verify by Grisha
            const verify = await grishaVerifyWithGoose(pipe.userMessage, pipe.atlasPlan, tetyanaExec.content, session.id);
            const confirmed = verify.confidence >= GRISHA_CONFIDENCE_THRESHOLD;
            const verdictMsg = confirmed
                ? `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО виконаним.`
                : `Незалежна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів. Посилити перевірку.`;
            const grishaVerdict = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            responses.push(grishaVerdict);
            session.history.push(grishaVerdict);

            if (!confirmed) {
                const missing = (verify.result?.criteria || []).filter(c => c && c.result === false).map(c => c.name);
                const ask = `Потрібно надати додаткові докази по: ${missing.join(', ') || 'не визначено'}. Надати конкретні шляхи/вміст/виходи команд.`;
                const grishaFollow = await generateAgentResponse('grisha', ask, session);
                responses.push(grishaFollow);
                session.history.push(grishaFollow);
                // update pipeline for next continuation
                pipe.stage = 'needs_more';
                pipe.need = missing;
                pipe.lastReport = tetyanaExec.content;
                session.nextAction = 'tetyana_supplement';
            } else {
                // clear pipeline
                session.pipeline = null;
                session.nextAction = null;
            }
        } else if (pipe.type === 'actionable' && pipe.stage === 'needs_more') {
            pipe.iter = (pipe.iter || 0) + 1;
            const extraPrompt = `Додаткові докази потрібні по: ${pipe.need?.join(', ') || 'не визначено'}. Надати конкретні файли/вміст/виходи команд. Онови звіт.`;
            const tetyanaMore = await generateAgentResponse('tetyana', extraPrompt, session, { enableTools: true });
            responses.push(tetyanaMore);
            session.history.push(tetyanaMore);

            const verify = await grishaVerifyWithGoose(pipe.userMessage, pipe.atlasPlan, tetyanaMore.content, session.id);
            const confirmed = verify.confidence >= GRISHA_CONFIDENCE_THRESHOLD;
            const verdictMsg = confirmed
                ? `Незалежна повторна перевірка: CONF=${verify.confidence.toFixed(2)} — Завдання ПІДТВЕРДЖЕНО.`
                : `Незалежна повторна перевірка: CONF=${verify.confidence.toFixed(2)} — Недостатньо доказів.`;
            const grishaVerdict = await generateAgentResponse('grisha', verdictMsg + (verify.result?.summary ? `\n${verify.result.summary}` : ''), session);
            responses.push(grishaVerdict);
            session.history.push(grishaVerdict);

            if (!confirmed && pipe.iter < GRISHA_MAX_VERIFY_ITER) {
                const missing = (verify.result?.criteria || []).filter(c => c && c.result === false).map(c => c.name);
                const ask = `Ще потрібно посилити докази по: ${missing.join(', ') || 'не визначено'}.`;
                const grishaFollow = await generateAgentResponse('grisha', ask, session);
                responses.push(grishaFollow);
                session.history.push(grishaFollow);
                pipe.need = missing;
                session.nextAction = 'tetyana_supplement';
            } else {
                session.pipeline = null;
                session.nextAction = null;
            }
        }

        res.json({
            success: true,
            response: responses,
            session: {
                id: session.id,
                currentAgent: session.currentAgent,
                requiresUserCommand: dialogueManager.requiresUserCommand(),
                nextAction: session.nextAction || null
            }
        });
    } catch (error) {
        logMessage('error', `/chat/continue failed: ${error.message}`);
        res.status(500).json({ error: 'continue failed', details: error.message });
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

// OpenAI-compat failover helpers for Atlas/Grisha
const AGENT_MODEL_PLAN = {
    atlas: [
        'Meta-Llama-3.1-8B-Instruct',
        'microsoft/Phi-3.5-mini-instruct',
        'gpt-4o-mini'
    ],
    grisha: [
        'microsoft/Phi-3.5-mini-instruct',
        'Mistral-Nemo',
        'gpt-4o-mini'
    ]
};

async function tryOpenAICompatForAgent(agentName, prompt) {
    if (!FALLBACK_API_BASE) return null;
    const models = AGENT_MODEL_PLAN[agentName] || [];
    for (const model of models) {
        try {
            const text = await callOpenAICompatChat(FALLBACK_API_BASE, model, prompt);
            if (text) return { text, provider: 'fallback_openai', model };
        } catch (_) {
            // try next model
        }
    }
    return null;
}

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
        // Tetiana strictly uses Goose
    let gooseText = await callGooseAgent(prompt, session.id, { enableTools: options.enableTools === true, systemInstruction: tetianaSystemInstruction({ enableTools: options.enableTools === true }) });
        if (!gooseText || isVagueTetianaResponse(gooseText)) {
            logMessage('warn', 'Tetyana returned vague/empty response. Retrying with strict report-only instruction.');
            const strictPrompt = `${tetianaSystemInstruction({ enableTools: options.enableTools === true })}\n\nКонтекст завдання:\n${inputMessage}\n\nСФОРМУЙ ЛИШЕ ЗВІТ за наведеним шаблоном. Без зайвих пояснень.`;
            gooseText = await callGooseAgent(strictPrompt, session.id, { enableTools: options.enableTools === true, systemInstruction: tetianaSystemInstruction({ enableTools: options.enableTools === true }) }) || gooseText;
        }
        content = enforceTetianaStructure(gooseText || 'Завдання опрацьовано.');
        provider = 'goose';
        model = 'github_copilot';
    } else {
        // Prefer Goose even for Atlas/Grisha (live intelligence), tools disabled
        const sysInstr = (agentName === 'atlas')
            ? 'Ти — ATLAS (стратег). Стисло сформуй план дій з чіткими кроками та точками контролю. Уникай води.'
            : 'Ти — ГРИША (контролер). Перевір план на безпеку та здійсненність, дай стислий конструктивний фідбек.';
        const gooseText = await callGooseAgent(prompt, session.id, { enableTools: false, systemInstruction: sysInstr });
        if (gooseText) {
            content = gooseText;
            provider = 'goose';
            model = 'github_copilot';
        } else {
            // Try OpenAI-compatible failover
            const tried = await tryOpenAICompatForAgent(agentName, prompt);
            if (tried && tried.text) {
                content = tried.text;
                provider = tried.provider;
                model = tried.model;
            } else {
                // Final minimal fallback
                content = await simulateAgentThinking(agentName, prompt);
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

// Call Goose agent (Tetyana) via WebSocket
async function callGooseAgent(message, sessionId, opts = {}) {
    const gooseBaseUrl = process.env.GOOSE_BASE_URL || 'http://localhost:3000';
    const secretKey = process.env.GOOSE_SECRET_KEY || 'test';
    
    try {
        // If tools are explicitly enabled, prefer SSE (it supports tool_choice)
        if (opts?.enableTools) {
            const sseToolsResult = await callGooseSSE(gooseBaseUrl, message, sessionId, secretKey, { enableTools: true, systemInstruction: opts.systemInstruction });
            if (sseToolsResult) return sseToolsResult;
        }

        // Otherwise try WebSocket first (preferred for regular chat)
        const result = await callGooseWebSocket(gooseBaseUrl, message, sessionId, secretKey);
        if (result) return result;
        
        // Fallback to SSE /reply endpoint (tools disabled)
    const sseResult = await callGooseSSE(gooseBaseUrl, message, sessionId, secretKey, { enableTools: false, systemInstruction: opts.systemInstruction });
        if (sseResult) return sseResult;
        
    // Final fallback -> signal failure so that upper layer can switch provider
    return null;
        
    } catch (error) {
    console.error('Goose integration error:', error);
    // Signal failure
    return null;
    }
}

// WebSocket integration with Goose
async function callGooseWebSocket(baseUrl, message, sessionId, secretKey) {
    return new Promise((resolve) => {
        const wsUrl = baseUrl.replace(/^http/, 'ws') + '/ws';
        
        let collected = '';
        let timeout;
        
        try {
            const ws = new WebSocket(wsUrl);
            
            timeout = setTimeout(() => {
                ws.close();
                resolve(null); // Will try SSE fallback
            }, 15000);
            
            ws.on('open', () => {
                const payload = {
                    type: 'message',
                    content: message,
                    session_id: sessionId,
                    timestamp: Date.now()
                };
                ws.send(JSON.stringify(payload));
            });
            
            ws.on('message', (data) => {
                try {
                    const obj = JSON.parse(data.toString());
                    const type = obj.type;
                    
                    if (type === 'response') {
                        const content = obj.content;
                        if (content) {
                            collected += String(content);
                        }
                    } else if (type === 'complete' || type === 'cancelled') {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(collected.trim() || "Завдання виконано.");
                    } else if (type === 'error') {
                        clearTimeout(timeout);
                        ws.close();
                        resolve(null); // Will try SSE fallback
                    }
                } catch (e) {
                    // Ignore non-JSON frames
                }
            });
            
            ws.on('error', () => {
                clearTimeout(timeout);
                resolve(null); // Will try SSE fallback
            });
            
            ws.on('close', () => {
                clearTimeout(timeout);
                if (collected.trim()) {
                    resolve(collected.trim());
                } else {
                    resolve(null); // Will try SSE fallback
                }
            });
            
        } catch (error) {
            if (timeout) clearTimeout(timeout);
            resolve(null); // Will try SSE fallback
        }
    });
}

// SSE integration with Goose (fallback)
async function callGooseSSE(baseUrl, message, sessionId, secretKey, options = { enableTools: false, systemInstruction: undefined }) {
    try {
        const url = `${baseUrl}/reply`;
        const headers = {
            'Accept': 'text/event-stream',
            'Content-Type': 'application/json',
            'X-Secret-Key': secretKey
        };
        
        // Build OpenAI-compatible messages; include a system instruction to allow tool usage when enabled
        const messages = [];
        if (options?.systemInstruction) {
            messages.push({
                role: 'system',
                created: Math.floor(Date.now() / 1000),
                content: [{ type: 'text', text: options.systemInstruction }]
            });
        }
        messages.push({
            role: 'user',
            created: Math.floor(Date.now() / 1000),
            content: [{ type: 'text', text: message }]
        });

        // Heuristic: use Desktop as working dir if user explicitly asked to save on Desktop
        const onDesktop = /робоч(ому|ий) стол|desktop/i.test(message || '');
        const workingDir = onDesktop ? path.join(os.homedir(), 'Desktop') : process.cwd();

        const payload = {
            messages,
            session_id: sessionId,
            session_working_dir: workingDir,
            ...(options?.enableTools ? { tool_choice: 'auto' } : {})
        };
        
        const response = await axios.post(url, payload, {
            headers,
            timeout: 20000,
            responseType: 'stream'
        });
        
        if (response.status !== 200) {
            return null;
        }
        
        return new Promise((resolve) => {
            let collected = '';
            
            response.data.on('data', (chunk) => {
                const lines = chunk.toString().split('\n');
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const dataStr = line.slice(5).trim();
                        try {
                            const obj = JSON.parse(dataStr);
                            if (obj.type === 'Message' && obj.message?.content) {
                                for (const content of obj.message.content) {
                                    if (content.type === 'text' && content.text) {
                                        collected += content.text;
                                    }
                                }
                                // Detect tool call hints in message payloads (diagnostic only)
                                if (obj.message?.tool_calls || obj.tool_calls) {
                                    console.warn('Goose indicated tool_calls in stream; current orchestrator does not execute tools inline yet.');
                                }
                            } else if (obj.type === 'Error' && obj.error) {
                                // Bubble error into logs for diagnostics
                                console.error('Goose SSE error frame:', obj.error);
                            } else if (obj.text || obj.content) {
                                collected += (obj.text || obj.content);
                            }
                        } catch (e) {
                            // Not JSON, might be plain text
                            if (dataStr && !dataStr.startsWith('[')) {
                                collected += dataStr;
                            }
                        }
                    }
                }
            });
            
            response.data.on('end', () => {
                resolve(collected.trim() || "Завдання опрацьовано.");
            });
            
            response.data.on('error', () => {
                console.error('Goose SSE stream error:', err?.message || err);
                resolve(collected.trim() || null);
            });
        });
        
    } catch (error) {
        try {
            if (axios.isAxiosError?.(error)) {
                const status = error.response?.status;
                const body = error.response?.data;
                let bodyStr = '';
                if (typeof body === 'string') bodyStr = body;
                else if (body && typeof body === 'object') {
                    try { bodyStr = JSON.stringify(body); } catch { bodyStr = '[non-serializable body]'; }
                } else bodyStr = String(body || '');
                console.error('Goose SSE request failed', status, bodyStr.slice(0, 2000));
            } else {
                console.error('Goose SSE request error', error?.message || String(error));
            }
        } catch {}
        return null;
    }
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

// Simulate agent thinking (for Atlas and Grisha)
async function simulateAgentThinking(agentName, prompt) {
    // This is a placeholder for Atlas and Grisha - Tetyana uses real Goose integration
    const responses = {
        atlas: [
            "Аналізую завдання. Створюю покроковий план виконання з урахуванням можливих ризиків.",
            "Розробляю стратегічний підхід. Визначаю ключові етапи та точки контролю.",
            "Планую ресурси та часові рамки. Готую детальні інструкції для виконання."
        ],
        grisha: [
            "Перевіряю план на безпеку та відповідність стандартам. Аналізую потенційні ризики.",
            "Оцінюю якість запропонованого рішення. Шукаю слабкі місця та недоліки.",
            "Контролюю дотримання процедур. Вимагаю додаткових гарантій безпеки."
        ]
    };

    const agentResponses = responses[agentName] || responses.atlas;
    const randomResponse = agentResponses[Math.floor(Math.random() * agentResponses.length)];
    
    // Add slight delay to simulate thinking
    await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
    
    return randomResponse;
}

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
    const gooseOut = await callGooseAgent(verifyPrompt, verifySession, { enableTools: true, systemInstruction: grishaSys });
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
                const refine = await callGooseAgent(refinePrompt, verifySession, { enableTools: true, systemInstruction: grishaSys });
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
    app.listen(PORT, () => {
        logMessage('info', `ATLAS Orchestrator running on port ${PORT}`);
        logMessage('info', 'Agent system initialized with TTS integration');
    });
}

export default app;