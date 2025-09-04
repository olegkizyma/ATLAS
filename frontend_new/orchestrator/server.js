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

const app = express();
const PORT = process.env.ORCH_PORT || 5101;

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
        voice: 'robot',
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
        
        res.json({
            success: true,
            response: response,
            session: {
                id: sessionId,
                currentAgent: session.currentAgent,
                requiresUserCommand: dialogueManager.requiresUserCommand()
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
async function generateAgentResponse(agentName, inputMessage, session) {
    const agent = AGENTS[agentName];
    const messageId = generateMessageId();
    
    // Create role-based prompt
    let prompt = createAgentPrompt(agentName, inputMessage, session);
    
    let content;
    let provider = undefined;
    let model = undefined;
    
    if (agentName === 'tetyana') {
        // Tetiana strictly uses Goose
        const gooseText = await callGooseAgent(prompt, session.id);
        content = gooseText || 'Завдання опрацьовано.';
        provider = 'goose';
        model = 'github_copilot';
    } else {
        // Try OpenAI-compatible failover for Atlas/Grisha first
        const tried = await tryOpenAICompatForAgent(agentName, prompt);
        if (tried && tried.text) {
            content = tried.text;
            provider = tried.provider;
            model = tried.model;
        } else {
            // Fallback to local simulation
            content = await simulateAgentThinking(agentName, prompt);
        }
    }
    
    return {
        role: 'assistant',
        content: `${agent.signature} ${content}`,
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
async function callGooseAgent(message, sessionId) {
    const gooseBaseUrl = process.env.GOOSE_BASE_URL || 'http://localhost:3000';
    const secretKey = process.env.GOOSE_SECRET_KEY || 'test';
    
    try {
        // Try WebSocket first (preferred for Goose Web)
        const result = await callGooseWebSocket(gooseBaseUrl, message, sessionId, secretKey);
        if (result) return result;
        
        // Fallback to SSE /reply endpoint
        const sseResult = await callGooseSSE(gooseBaseUrl, message, sessionId, secretKey);
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
async function callGooseSSE(baseUrl, message, sessionId, secretKey) {
    try {
        const url = `${baseUrl}/reply`;
        const headers = {
            'Accept': 'text/event-stream',
            'Content-Type': 'application/json',
            'X-Secret-Key': secretKey
        };
        
        const payload = {
            messages: [{
                role: 'user',
                created: Math.floor(Date.now() / 1000),
                content: [{ type: 'text', text: message }]
            }],
            session_id: sessionId,
            session_working_dir: process.cwd()
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
                resolve(collected.trim() || null);
            });
        });
        
    } catch (error) {
        return null;
    }
}

// Simulate agent thinking (for Atlas and Grisha)

// Create prompts based on agent roles
function createAgentPrompt(agentName, message, session) {
    const baseContext = `You are ${agentName.toUpperCase()}, a specialized AI agent in the ATLAS system.`;
    
    switch (agentName) {
        case 'atlas':
            return `${baseContext} You are the strategist and planner. Analyze the task and create a detailed execution plan. Consider potential challenges and create clear steps. Be authoritative but open to discussion.

User request: ${message}
Recent context: ${getRecentHistory(session, 3)}

Respond as Atlas would - strategic, analytical, planning-focused.`;

        case 'grisha':
            return `${baseContext} You are the validator and controller. Review plans for safety, feasibility, and quality. You have veto power if something seems unsafe or inefficient. Be thorough and critical but constructive.

Plan to review: ${message}
Session context: ${getRecentHistory(session, 3)}

Respond as Grisha would - cautious, thorough, security-focused.`;

        case 'tetyana':
            return `${baseContext} You are the executor and implementer. You handle the practical aspects of task execution. Provide concrete steps, ask clarifying questions, and report on feasibility from an execution standpoint.

Task context: ${message}
Session context: ${getRecentHistory(session, 3)}

Respond as Tetyana would - practical, detail-oriented, execution-focused.`;

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
app.listen(PORT, () => {
    logMessage('info', `ATLAS Orchestrator running on port ${PORT}`);
    logMessage('info', 'Agent system initialized with TTS integration');
});

export default app;