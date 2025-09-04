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

// Generate agent response based on role and context
async function generateAgentResponse(agentName, inputMessage, session) {
    const agent = AGENTS[agentName];
    const messageId = generateMessageId();
    
    // Create role-based prompt
    let prompt = createAgentPrompt(agentName, inputMessage, session);
    
    // Simulate agent thinking (replace with actual LLM call)
    const content = await simulateAgentThinking(agentName, prompt);
    
    return {
        role: 'assistant',
        content: `${agent.signature} ${content}`,
        agent: agentName,
        messageId: messageId,
        timestamp: Date.now(),
        voice: agent.voice,
        color: agent.color
    };
}

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

// Simulate agent thinking (replace with actual LLM integration)
async function simulateAgentThinking(agentName, prompt) {
    // This is a placeholder - integrate with actual LLM service
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
        ],
        tetyana: [
            "Аналізую практичну реалізацію. Готуюся до виконання конкретних кроків.",
            "Перевіряю доступність ресурсів. Розробляю деталізований план дій.",
            "Готую звіт про готовність до виконання. Визначаю необхідні інструменти."
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