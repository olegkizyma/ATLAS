/**
 * Atlas Intelligent Voice-Enhanced Chat Manager
 * Розумне управління чатом з підтримкою голосових агентів
 */
class AtlasIntelligentChatManager {
    constructor() {
    this.isStreaming = false;
    this.isStreamPending = false;
    this.messages = [];
    // Separate bases: orchestrator (Node, 5101) and frontend (Flask, 5001)
    this.orchestratorBase = 'http://localhost:5101';
    this.frontendBase = (window.ATLAS_CFG && window.ATLAS_CFG.frontendBase) || window.location.origin;
        this.retryCount = 0;
        this.maxRetries = 3;
        
        // Voice system properties with enhanced agent differentiation
        this.voiceSystem = {
            enabled: false,
            agents: {
                atlas: { 
                    signature: '[ATLAS]', 
                    color: '#00ff00', 
                    voice: 'dmytro',
                    pitch: 1.0,
                    rate: 1.0,
                    priority: 1 
                },
                tetyana: { 
                    signature: '[ТЕТЯНА]', 
                    color: '#00ffff', 
                    voice: 'tetiana',
                    pitch: 1.05, 
                    rate: 1.0,
                    priority: 2,
                    noFallback: true // без фолбеку для Тетяни
                },
                grisha: { 
                    signature: '[ГРИША]', 
                    color: '#ffff00', 
            voice: 'mykyta',
                    pitch: 0.9,
                    rate: 1.1,
                    priority: 3 
                }
            },
            currentAudio: null,
        // Загальний список фолбеків (тільки валідні голоси українського TTS)
        fallbackVoices: ['dmytro', 'oleksa', 'mykyta', 'tetiana'],
            maxRetries: 4, // Збільшуємо з 2 до 4 спроб
        // Глобальний прапорець дозволу Web Speech API як фолбеку (за замовчуванням вимкнено)
        allowWebSpeechFallback: false,
            // TTS synchronization system
            agentMessages: new Map(), // Store accumulated messages per agent  
            ttsQueue: [], // Queue for TTS processing
            isProcessingTTS: false, // Flag to prevent parallel TTS processing
            lastAgentComplete: null, // Track when agent finishes speaking
            firstTtsDone: false // Guard to avoid double TTS on very first response
        };

        // STT (Speech-to-Text) system for user interruptions
        this.speechSystem = {
            enabled: false,
            recognition: null,
            isListening: false,
            isEnabled: false,
            permissionDenied: false,
            continuous: true,
            interimResults: true,
            language: 'uk-UA', // Ukrainian as primary
            fallbackLanguage: 'en-US',
            confidenceThreshold: 0.5, // Знижено з 0.7 до 0.5 для кращого розпізнання
            // Interruption detection
            interruptionKeywords: [
                'стоп', 'stop', 'чекай', 'wait', 'припини', 'pause',
                'наказую', 'command', 'я наказую', 'слухайте', 'тихо'
            ],
            commandKeywords: [
                'наказую', 'command', 'я наказую', 'слухай мене', 'виконуй'
            ]
        };
        
        // Поведінка синхронізації TTS з наступними повідомленнями та кроками виконання
        this.ttsSync = {
            // Якщо true — нові повідомлення користувача будуть чекати завершення поточного озвучування
            blockNextMessageUntilTTSComplete: false,
            // Диспатчити DOM-події для інтеграції сторонніх модулів (кроки виконання, аналітика)
            dispatchEvents: true,
            // Хуки керування кроками виконання (за потреби заміни цими методами зовні)
            onTTSStart: () => {},
            onTTSEnd: () => {},
            // Строга синхронізація агентів: кожен агент чекає завершення попереднього
            strictAgentOrder: true,
            // Максимальний час очікування завершення TTS перед форсуванням (мс)
            maxWaitTime: 45000,
            // Прапорець для відстеження стану синхронізації
            isWaitingForTTS: false
        };
        
        this.init();
    }

    // Lightweight UA translation for frequent UI phrases and agent meta; does not translate full content
    translateToUAInline(text) {
        if (!text) return '';
        const map = [
            // common headers and labels
            [/^\s*Summary\s*:?/gi, 'Підсумок:'],
            [/^\s*Plan\s*:?/gi, 'План:'],
            [/^\s*Next steps\s*:?/gi, 'Наступні кроки:'],
            [/^\s*Action\s*:?/gi, 'Дія:'],
            [/^\s*Note\s*:?/gi, 'Примітка:'],
            // tiny inline words
            [/\bYes\b/gi, 'Так'],
            [/\bNo\b/gi, 'Ні'],
            [/\bOK\b/gi, 'Гаразд'],
        ];
        let out = text;
        for (const [re, ua] of map) out = out.replace(re, ua);
        return out;
    }

    // Segment text into short phrases for TTS, force UA-facing content with light translation
    segmentForTTS(text, agent = 'atlas') {
        if (!text) return [];
        // Strip signatures like [ATLAS] or NAME:
        let clean = String(text).replace(/^\s*\[[^\]]+\]\s*/i, '').replace(/^\s*[A-ZА-ЯІЇЄҐ]+\s*:\s*/i, '');
        // Remove markdown headers and dividers
        clean = clean.replace(/^#+\s+/gm, '').replace(/^---+$/gm, '');
        // Prefer [VOICE] lines for tetyana
        if (agent === 'tetyana') {
            const voiceOnly = this.extractVoiceOnly(clean);
            clean = voiceOnly || clean;
        }
        // Light UA inline translation for small phrases
        clean = this.translateToUAInline(clean);
        // Split into sentences and clamp length
        const parts = clean
            .split(/(?<=[.!?…])\s+|\n+/)
            .map(s => s.trim())
            .filter(Boolean);
        const MAX = 140; // target short phrases
        const result = [];
        for (let p of parts) {
            if (p.length <= MAX) { result.push(p); continue; }
            // Further split by commas/semicolons
            const sub = p.split(/[,;:\u2014]\s+/).map(s => s.trim()).filter(Boolean);
            let buf = '';
            for (const s of sub) {
                if ((buf + ' ' + s).trim().length > MAX) {
                    if (buf) result.push(buf.trim());
                    buf = s;
                } else {
                    buf = (buf ? buf + ' ' : '') + s;
                }
            }
            if (buf) result.push(buf.trim());
        }
        return result.slice(0, 20); // safety cap per message
    }

    // Subtitles overlay synced roughly with audio play
    showSubtitles(text) {
        if (!text) return;
        let el = document.getElementById('atlas-subtitles');
        if (!el) {
            el = document.createElement('div');
            el.id = 'atlas-subtitles';
            el.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);'+
                'background:rgba(0,0,0,.75);color:#eaffea;padding:6px 10px;border-radius:8px;'+
                'font:14px/1.35 system-ui,Segoe UI,Arial;z-index:9999;max-width:80vw;text-align:center;'+
                'box-shadow:0 0 10px rgba(0,255,127,.25)';
            document.body.appendChild(el);
        }
        el.textContent = text;
        clearTimeout(this._subsTimer);
        this._subsTimer = setTimeout(() => { el.remove(); }, 3000);
    }

    // Об'єднання коротких сегментів у великі блоки для одного TTS-виклику
    combineSegmentsForAgent(segments, agent = 'atlas') {
        const MAX_CHARS = 600; // ~40с на бекенді (0.06*n + 5)
        const out = [];
        let buf = '';
        for (const seg of segments) {
            const s = seg.trim();
            if (!s) continue;
            if (!buf) { buf = s; continue; }
            if ((buf + ' ' + s).length <= MAX_CHARS) {
                buf = `${buf} ${s}`;
            } else {
                out.push(buf);
                buf = s;
            }
        }
        if (buf) out.push(buf);
        return out.length ? out : segments;
    }
    
    async init() {
        this.chatInput = document.getElementById('message-input');
        this.chatButton = document.getElementById('send-button');
        this.chatContainer = document.getElementById('chat-container');
        
        if (!this.chatInput || !this.chatButton || !this.chatContainer) {
            console.warn('Chat elements not found - chat functionality disabled (minimal mode)');
            return;
        }
        
        this.setupEventListeners();
    this.setupAutoScroll();
    this.setupTTSEventBridges();
        await this.initVoiceSystem();
        await this.initSpeechSystem();
        this.log('[CHAT] Intelligent Atlas Chat Manager with Voice and Speech Systems initialized');
    }

    setupTTSEventBridges() {
        // Приклад інтеграції з кроками виконання програми (слухачі подій)
        window.addEventListener('atlas-tts-started', (e) => {
            // e.detail: { agent, text }
            // TODO: тут можна поставити «крок: відтворення голосу почалося»
        });
        window.addEventListener('atlas-tts-ended', (e) => {
            // e.detail: { agent, text }
            // TODO: тут можна перейти до наступного кроку після завершення озвучування
        });
    }
    
    async initVoiceSystem() {
        try {
            // Перевіряємо доступність voice API
            const response = await fetch(`${this.frontendBase}/api/voice/health`);
            if (response.ok) {
                const data = await response.json();
                // Раніше очікувалось data.success; API повертає available/status
                this.voiceSystem.enabled = (data && (data.success === true || data.available === true || String(data.status || '').toLowerCase() === 'running'));
                this.log(`[VOICE] Voice system ${this.voiceSystem.enabled ? 'enabled' : 'disabled'}`);
                
                if (this.voiceSystem.enabled) {
                    // Завантажуємо інформацію про агентів
                    await this.loadAgentInfo();
                    this.addVoiceControls();
                    
                    // Увімкнути голосову систему за замовчуванням
                    if (!localStorage.getItem('atlas_voice_enabled')) {
                        this.setVoiceEnabled(true);
                        this.log('[VOICE] Voice system enabled by default');
                    }
                }
            }
        } catch (error) {
            this.log(`[VOICE] Voice system unavailable: ${error.message}`);
            this.voiceSystem.enabled = false;
        }
    }
    
    async loadAgentInfo() {
        try {
            const response = await fetch(`${this.frontendBase}/api/voice/agents`);
            if (response.ok) {
                const data = await response.json();
                if (data.success && data.agents) {
                    // Оновлюємо інформацію про агентів
                    Object.keys(data.agents).forEach(agentName => {
                        if (this.voiceSystem.agents[agentName]) {
                            this.voiceSystem.agents[agentName] = {
                                ...this.voiceSystem.agents[agentName],
                                ...data.agents[agentName]
                            };
                        }
                    });
                    this.log('[VOICE] Agent information loaded successfully');
                }
            }
        } catch (error) {
            this.log(`[VOICE] Failed to load agent info: ${error.message}`);
        }
    }
    
    addVoiceControls() {
        // Використовуємо існуючу кнопку voice-toggle замість створення нової
        const existingVoiceButton = document.getElementById('voice-toggle');
        if (existingVoiceButton) {
            existingVoiceButton.onclick = () => this.toggleVoice();
            existingVoiceButton.title = 'Увімкнути/Вимкнути озвучування';
            this.log('[VOICE] Voice controls initialized with existing button');
        } else {
            this.log('[VOICE] Warning: voice-toggle button not found');
        }
        
        // Додаємо індикатор поточного агента (праворуч у верхньому куті)
        const agentIndicator = document.createElement('div');
        agentIndicator.id = 'current-agent';
        agentIndicator.className = 'agent-indicator';
        agentIndicator.innerHTML = '<span id="agent-name">ATLAS</span>';
        
        const chatContainer = this.chatContainer.parentElement;
        if (chatContainer) {
            chatContainer.insertBefore(agentIndicator, this.chatContainer);
            // Поруч з індикатором агента монтуємо точки статусів
            const statusDots = document.createElement('div');
            statusDots.id = 'status-dots';
            statusDots.className = 'status-dots';
            statusDots.innerHTML = `
                <span class="status-dot" id="dot-frontend" data-tooltip="Frontend: initializing" title="Frontend: initializing"></span>
                <span class="status-dot" id="dot-orchestrator" data-tooltip="Orchestrator: connecting" title="Orchestrator: connecting"></span>
                <span class="status-dot" id="dot-recovery" data-tooltip="Recovery: connecting" title="Recovery: connecting"></span>
                <span class="status-dot" id="dot-tts" data-tooltip="TTS: checking" title="TTS: checking"></span>
            `;
            agentIndicator.parentElement.insertBefore(statusDots, agentIndicator);
            // Попросимо статус-менеджер негайно оновити стан точок
            try {
                if (window.atlasStatus && typeof window.atlasStatus.updateStatus === 'function') {
                    window.atlasStatus.updateStatus();
                }
            } catch (_) {}
        }
    }
    
    setupEventListeners() {
        // Кнопка відправки
        this.chatButton.addEventListener('click', () => this.sendMessage());
        
        // Enter для відправки
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Автоматичне розблокування кожні 5 секунд
        setInterval(() => {
            this.checkAndUnlockInput();
        }, 5000);
    }
    
    async sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message || this.isStreaming || this.ttsSync.isWaitingForTTS) {
            this.log('[CHAT] Message blocked: streaming or waiting for TTS');
            return;
        }
        
        // За потреби — чекаємо завершення поточного озвучування перед надсиланням нового повідомлення
        if (this.ttsSync.blockNextMessageUntilTTSComplete) {
            this.ttsSync.isWaitingForTTS = true;
            this.setInputState(false);
            this.log('[CHAT] Waiting for TTS to complete before sending message...');
            
            try {
                await this.waitForTTSIdle(this.ttsSync.maxWaitTime);
            } catch (error) {
                this.log(`[CHAT] TTS wait error: ${error.message}`);
            } finally {
                this.ttsSync.isWaitingForTTS = false;
            }
        }
        
        this.addMessage(message, 'user');
        this.chatInput.value = '';
        this.setInputState(false);
        
        try {
            // Потоковий стрім із Node Orchestrator (SSE)
            await this.streamFromOrchestrator(message);
            
        } catch (error) {
            this.log(`[ERROR] Failed to send message: ${error.message}`);
            this.addMessage(`❌ Помилка відправки: ${error.message}`, 'error');
        } finally {
            // Додаткова перевірка: чекаємо завершення всіх TTS перед розблокуванням
            if (this.ttsSync.strictAgentOrder) {
                await this.waitForTTSIdle(5000);
            }
            this.setInputState(true);
        }
    }

    // Очікувати завершення усіх поточних TTS (поточне відтворення + черга)
    async waitForTTSIdle(timeoutMs = 20000) {
        try {
            const start = Date.now();
            this.log(`[TTS] Waiting for TTS idle (timeout: ${timeoutMs}ms)`);
            
            // Швидкий вихід, якщо нічого не відтворюється
            if (!this.voiceSystem.currentAudio && 
                this.voiceSystem.ttsQueue.length === 0 && 
                !this.voiceSystem.isProcessingTTS) {
                this.log('[TTS] Already idle, returning immediately');
                return;
            }
            
            await new Promise(resolve => {
                const check = () => {
                    const isCurrentAudioIdle = !this.voiceSystem.currentAudio || 
                                               this.voiceSystem.currentAudio.paused || 
                                               this.voiceSystem.currentAudio.ended;
                    const isQueueEmpty = this.voiceSystem.ttsQueue.length === 0;
                    const isNotProcessing = !this.voiceSystem.isProcessingTTS;
                    
                    const idle = isCurrentAudioIdle && isQueueEmpty && isNotProcessing;
                    
                    if (idle) {
                        this.log('[TTS] TTS is now idle');
                        return resolve();
                    }
                    
                    if (Date.now() - start > timeoutMs) {
                        this.log(`[TTS] TTS wait timeout after ${timeoutMs}ms`);
                        return resolve();
                    }
                    
                    setTimeout(check, 200);
                };
                check();
            });
            
            // Додаткова пауза для стабільності
            if (this.ttsSync.strictAgentOrder) {
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
        } catch (error) {
            this.log(`[TTS] Wait for idle error: ${error.message}`);
        }
    }
    
    async handleIntelligentResponse(data) {
        if (!data || !data.response) {
            this.addMessage('❌ Порожня відповідь від системи', 'error');
            return;
        }
        
        const responseText = data.response;
        
        if (this.voiceSystem.enabled) {
            // Використовуємо розумну систему визначення агента
            await this.processVoiceResponse(responseText);
        } else {
            // Відображаємо звичайну відповідь
            this.addMessage(responseText, 'assistant');
        }
    }
    
    async streamFromOrchestrator(message, retryAttempt = 0) {
        const maxRetries = 3;
        const timeoutDuration = 30000; // 30 seconds timeout
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            this.log(`Request timeout after ${timeoutDuration/1000}s (attempt ${retryAttempt + 1})`);
            controller.abort();
        }, timeoutDuration);
        
        this.isStreaming = true;
        
        try {
            this.log(`Starting Orchestrator request (attempt ${retryAttempt + 1}/${maxRetries + 1})...`);
            
            const response = await fetch(`${this.orchestratorBase}/chat/stream`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    message, 
                    sessionId: this.getSessionId(),
                    retryAttempt: retryAttempt
                }),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }
            
            // Handle JSON response from orchestrator
            const data = await response.json();
            
            if (data.success && data.response && Array.isArray(data.response)) {
                this.log(`Received ${data.response.length} agent responses`);
                
                // Process each agent response sequentially
                for (const agentResponse of data.response) {
                    const agent = agentResponse.agent || 'atlas';
                    const content = agentResponse.content || '';
                    const signature = agentResponse.signature || this.voiceSystem.agents[agent]?.signature;
                    
                    // Add message to chat
                    this.addVoiceMessage(content, agent, signature);
                    
                    // Add to TTS queue if voice is enabled
                    if (this.voiceSystem.enabled && this.isVoiceEnabled() && content.trim()) {
                        const segments = this.segmentForTTS(content, agent);
                        const batched = this.combineSegmentsForAgent(segments, agent);
                        for (const seg of batched) {
                            this.voiceSystem.ttsQueue.push({ text: seg, agent });
                        }
                    }
                    
                    // Small delay between messages for better UX
                    await this.delay(500);
                }
                
                // Process TTS queue
                if (this.voiceSystem.ttsQueue.length > 0) {
                    this.processTTSQueue();
                }

                // If orchestrator indicates nextAction, continue pipeline only after TTS completes
                if (data.session && data.session.nextAction) {
                    this.log(`[CHAT] Next action scheduled: ${data.session.nextAction}. Waiting for TTS to finish...`);
                    await this.waitForTTSIdle(60000);
                    await this.continuePipeline(data.session.id, 0);
                }

                this.log('Agent conversation completed successfully');
            } else {
                throw new Error('Invalid response format from orchestrator');
            }
            
        } catch (error) {
            clearTimeout(timeoutId);
            
            if (error.name === 'AbortError') {
                this.log(`[ERROR] Request aborted (timeout after ${timeoutDuration/1000}s)`);
            } else {
                this.log(`[ERROR] Orchestrator request failed: ${error.message}`);
            }
            
            if (retryAttempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, retryAttempt), 10000);
                this.log(`Retrying in ${delay/1000}s...`);
                await this.delay(delay);
                return await this.streamFromOrchestrator(message, retryAttempt + 1);
            } else {
                // Show error message to user
                this.addMessage(`❌ Не вдалося отримати відповідь від агентів: ${error.message}`, 'error');
                throw error;
            }
        } finally {
            this.isStreaming = false;
            clearTimeout(timeoutId);
        }
    }

    async continuePipeline(sessionId, depth = 0) {
        if (!sessionId) return;
        if (depth > 5) { this.log('[CHAT] Max continuation depth reached'); return; }
        try {
            const response = await fetch(`${this.orchestratorBase}/chat/continue`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId })
            });
            if (!response.ok) {
                const t = await response.text().catch(() => '');
                throw new Error(`continue HTTP ${response.status}: ${t}`);
            }
            const data = await response.json();
            if (!(data && data.success && Array.isArray(data.response))) {
                this.log('[CHAT] Invalid continue payload');
                return;
            }

            // Render responses
            for (const agentResponse of data.response) {
                const agent = agentResponse.agent || 'atlas';
                const content = agentResponse.content || '';
                const signature = agentResponse.signature || this.voiceSystem.agents[agent]?.signature;
                this.addVoiceMessage(content, agent, signature);
                if (this.voiceSystem.enabled && this.isVoiceEnabled() && content.trim()) {
                    const raw = content.replace(/^\[.*?\]\s*/, '');
                    const segs = this.segmentForTTS(raw, agent);
                    const batched = this.combineSegmentsForAgent(segs, agent);
                    for (const seg of batched) this.voiceSystem.ttsQueue.push({ text: seg, agent });
                }
                await this.delay(400);
            }
            if (this.voiceSystem.ttsQueue.length > 0) {
                this.processTTSQueue();
            }

            if (data.session && data.session.nextAction) {
                this.log(`[CHAT] Next action: ${data.session.nextAction}. Waiting for TTS…`);
                await this.waitForTTSIdle(60000);
                return await this.continuePipeline(data.session.id, depth + 1);
            }
        } catch (error) {
            this.log(`[CHAT] Continue pipeline failed: ${error.message}`);
        }
    }
    appendToMessage(messageTextElement, delta) {
        if (!messageTextElement) return;
        messageTextElement.innerHTML += this.formatMessage(delta);
    this.scrollToBottomIfNeeded();
    }

    async processVoiceResponse(responseText) {
        try {
            // Визначаємо агента та підготовляємо відповідь
            const prepareResponse = await fetch(`${this.frontendBase}/api/voice/prepare_response`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: responseText
                })
            });
            
            if (prepareResponse.ok) {
                const prepData = await prepareResponse.json();
                if (prepData.success) {
                    // Відображаємо ТІЛЬКИ зміст без лейблу на початку
                    this.addVoiceMessage(
                        prepData.text,
                        prepData.agent,
                        prepData.signature
                    );
                    
                    // Синтезуємо голос якщо потрібно
                    if (this.isVoiceEnabled()) {
                        // Respect one-shot guard for the first TTS playback
                        if (!this.voiceSystem.firstTtsDone) {
                            this.voiceSystem.firstTtsDone = true;
                            await this.synthesizeAndPlay(prepData.text, prepData.agent);
                        } else {
                            await this.synthesizeAndPlay(prepData.text, prepData.agent);
                        }
                    }
                    
                    // Оновлюємо індикатор поточного агента
                    this.updateCurrentAgent(prepData.agent);
                    
                } else {
                    throw new Error('Failed to prepare voice response');
                }
            }
        } catch (error) {
            this.log(`[VOICE] Error processing voice response: ${error.message}`);
            // Fallback на звичайне відображення
            this.addMessage(responseText, 'assistant');
        }
    }
    
    // Helper method for retry delays
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    // Enhanced voice processing for different agents
    async processAgentVoice(text, agent) {
        if (!this.voiceSystem.enabled || !this.isVoiceEnabled()) {
            return;
        }
        
        try {
            const agentConfig = this.voiceSystem.agents[agent] || this.voiceSystem.agents.atlas;
            
            // Short text fragments don't need voice synthesis
            if (text.length < 10) {
                return;
            }
            
            // Add to TTS queue instead of immediate synthesis
            this.voiceSystem.ttsQueue.push({
                text: text,
                agent: agent,
                timestamp: Date.now()
            });
            
            // Process queue if not already processing
            if (!this.voiceSystem.isProcessingTTS) {
                await this.processTTSQueue();
            }
            
        } catch (error) {
            this.log(`[VOICE] Agent voice processing error: ${error.message}`);
        }
    }

    async finalizeAgentMessage(currentAgent) {
        if (!this.voiceSystem.enabled || !this.isVoiceEnabled()) {
            return;
        }

        // Визначаємо канонічне ім'я агента за класом повідомлення
        const agentName = this.getCanonicalAgentName(currentAgent);
        if (!agentName) return;

    const fullMessage = this.voiceSystem.agentMessages.get(agentName);
        if (!fullMessage || fullMessage.trim().length < 10) {
            // Clear message and return if too short
            this.voiceSystem.agentMessages.delete(agentName);
            return;
        }

    this.log(`[VOICE] Finalizing TTS for ${agentName}: "${fullMessage.substring(0, 50)}..."`);

        try {
            // Wait for previous TTS to complete
            if (this.voiceSystem.currentAudio) {
                await new Promise(resolve => {
                    if (this.voiceSystem.currentAudio.ended || this.voiceSystem.currentAudio.paused) {
                        resolve();
                    } else {
                        this.voiceSystem.currentAudio.onended = resolve;
                        // Timeout after 10 seconds
                        setTimeout(resolve, 10000);
                    }
                });
            }

            // Синтез: для Тетяни — лише [VOICE]-рядки, інакше — увесь текст
            // One-shot guard: avoid double playback for the very first synthesized message
            if (!this.voiceSystem.firstTtsDone) {
                this.voiceSystem.firstTtsDone = true;
                await this.synthesizeAndPlay(fullMessage, agentName);
            } else {
                await this.synthesizeAndPlay(fullMessage, agentName);
            }

            // Clear the accumulated message
            this.voiceSystem.agentMessages.delete(agentName);

        } catch (error) {
            this.log(`[VOICE] Failed to finalize agent message: ${error.message}`);
            this.voiceSystem.agentMessages.delete(agentName);
        }
    }

    // Витягає лише короткі рядки для озвучування у форматі [VOICE] ... або VOICE: ...
    extractVoiceOnly(text) {
        if (!text) return '';
        const lines = String(text).split(/\r?\n/);
        const picked = [];
        for (const line of lines) {
            const m1 = line.match(/^\s*\[VOICE\]\s*(.+)$/i);
            const m2 = line.match(/^\s*VOICE\s*:\s*(.+)$/i);
            const fragment = (m1 && m1[1]) || (m2 && m2[1]) || null;
            if (fragment) {
                // Обрізаємо до розумної довжини, щоб фрази були короткі
                picked.push(fragment.trim());
            }
        }
        const result = picked.join(' ').trim();
        // Обмежуємо довжину фрази для промовляння
        return result.length > 220 ? result.slice(0, 220) : result;
    }

    async processTTSQueue() {
        if (this.voiceSystem.isProcessingTTS || this.voiceSystem.ttsQueue.length === 0) {
            return;
        }

        this.voiceSystem.isProcessingTTS = true;
        this.log(`[TTS] Starting TTS queue processing (${this.voiceSystem.ttsQueue.length} items)`);

        try {
            while (this.voiceSystem.ttsQueue.length > 0) {
                const ttsItem = this.voiceSystem.ttsQueue.shift();
                this.log(`[TTS] Processing queue item for ${ttsItem.agent}: "${ttsItem.text.substring(0, 50)}..."`);
                // small subtitle hint before playback
                this.showSubtitles(ttsItem.text);
                
                // Wait for current TTS to finish if strict ordering is enabled
                if (this.ttsSync.strictAgentOrder && this.voiceSystem.currentAudio && !this.voiceSystem.currentAudio.paused) {
                    this.log('[TTS] Waiting for current audio to finish (strict ordering)');
                    await new Promise(resolve => {
                        const checkFinished = () => {
                            if (!this.voiceSystem.currentAudio || 
                                this.voiceSystem.currentAudio.paused || 
                                this.voiceSystem.currentAudio.ended) {
                                resolve();
                            } else {
                                setTimeout(checkFinished, 100);
                            }
                        };
                        
                        // Set up onended handler as backup
                        if (this.voiceSystem.currentAudio) {
                            this.voiceSystem.currentAudio.onended = resolve;
                        }
                        
                        // Timeout after 30 seconds
                        setTimeout(resolve, 30000);
                        
                        checkFinished();
                    });
                }

                // Synthesize the text with agent-specific settings
                await this.synthesizeAndPlay(ttsItem.text, ttsItem.agent);
                
                // Add delay between agents for natural flow
                if (this.ttsSync.strictAgentOrder && this.voiceSystem.ttsQueue.length > 0) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } catch (error) {
            this.log(`[TTS] TTS queue processing error: ${error.message}`);
        } finally {
            this.voiceSystem.isProcessingTTS = false;
            this.log('[TTS] TTS queue processing completed');
            
            // Notify that TTS processing is done
            if (this.ttsSync.dispatchEvents) {
                window.dispatchEvent(new CustomEvent('atlas-tts-queue-complete'));
            }
        }
    }

    async synthesizeAndPlay(text, agent, retryCount = 0) {
        try {
            // Перевіряємо доступність TTS сервісу перед запитом
            if (retryCount === 0) {
                try {
                    const healthController = new AbortController();
                    const healthTimeout = setTimeout(() => healthController.abort(), 5000);
                    const healthResponse = await fetch(`${this.frontendBase}/api/voice/health`, { 
                        method: 'GET',
                        signal: healthController.signal
                    });
                    clearTimeout(healthTimeout);
                    if (!healthResponse.ok) {
                        this.log(`[VOICE] TTS service unhealthy (${healthResponse.status}), but trying anyway...`);
                    }
                } catch (healthError) {
                    this.log(`[VOICE] TTS health check failed: ${healthError.message}, but trying anyway...`);
                }
            }
            
            // Зупиняємо поточне відтворення
            if (this.voiceSystem.currentAudio) {
                this.voiceSystem.currentAudio.pause();
                this.voiceSystem.currentAudio = null;
            }
            
            const agentConfig = this.voiceSystem.agents[agent] || this.voiceSystem.agents.atlas;
            const voice = agentConfig.voice;

            // Для Тетяни: спершу пробуємо [VOICE], інакше стислий підсумок для TTS
            let speechText = text;
            if (agent === 'tetyana') {
                const voiceOnly = this.extractVoiceOnly(text);
                speechText = voiceOnly && voiceOnly.trim().length > 0 ? voiceOnly : this.summarizeTetianaForTTS(text);
                if (!speechText || speechText.trim().length === 0) {
                    // фолбек: обрізаємо чистий текст без markdown
                    speechText = String(text).replace(/^#+\s+/gm, '').replace(/\*\*|__|`/g, '').split(/\n+/).map(s=>s.trim()).filter(Boolean).slice(0,3).join('. ');
                }
            }

            // Ensure Ukrainian output: attempt light client translation when text looks English
            if (/\b(the|and|to|of|for|with|is|are|in)\b/i.test(speechText) && !/[А-ЯІЇЄҐа-яіїєґ]/.test(speechText)) {
                try {
                    const tr = await fetch(`${this.frontendBase}/api/translate`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: speechText, source: 'en', target: 'uk' })
                    }).then(r => r.ok ? r.json() : null).catch(() => null);
                    if (tr && tr.success && tr.text) {
                        speechText = tr.text;
                    } else {
                        // fallback: minimal inline translation map
                        speechText = this.translateToUAInline(speechText);
                    }
                } catch (_) {
                    speechText = this.translateToUAInline(speechText);
                }
            }
            
            this.log(`[VOICE] Synthesizing ${agent} voice with ${voice} (attempt ${retryCount + 1})`);
            
            // Збільшуємо таймаут з 15 до 30 секунд для довгих текстів
            const controller = new AbortController();
            const timeout = Math.max(30000, speechText.length * 50); // Мінімум 30с, +50мс за символ
            const t = setTimeout(() => controller.abort(), timeout);
            
            // Синтезуємо голос з налаштуваннями агента
            const response = await fetch(`${this.frontendBase}/api/voice/synthesize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: speechText,
                    agent: agent,
                    voice: voice,
                    pitch: agentConfig.pitch || 1.0,
                    rate: agentConfig.rate || 1.0
                }),
                signal: controller.signal
            });
            clearTimeout(t);
            
            if (!response.ok) {
                // Покращена обробка помилок з детальним логуванням
                const errorDetails = `HTTP ${response.status} ${response.statusText}`;
                this.log(`[VOICE] TTS failed: ${errorDetails} (attempt ${retryCount + 1}/${this.voiceSystem.maxRetries + 1})`);
                
                // Дозволяємо ретраї для всіх агентів; фолбек-голос лише якщо дозволено
                if (retryCount < this.voiceSystem.maxRetries) {
                    this.log(`[VOICE] Retrying TTS in ${500 * (retryCount + 1)}ms...`);
                    await this.delay(500 * (retryCount + 1));
                    return await this.synthesizeAndPlay(text, agent, retryCount + 1);
                }
                if (!agentConfig.noFallback) {
                    const fallbackVoice = this.voiceSystem.fallbackVoices[retryCount % this.voiceSystem.fallbackVoices.length];
                    this.log(`[VOICE] Voice synthesis failed, trying fallback voice: ${fallbackVoice}`);
                    const controller2 = new AbortController();
                    const timeout2 = Math.max(30000, speechText.length * 50); // Такий же таймаут для fallback
                    const t2 = setTimeout(() => controller2.abort(), timeout2);
                    const fallbackResponse = await fetch(`${this.frontendBase}/api/voice/synthesize`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: speechText, agent, voice: fallbackVoice, pitch: 1.0, rate: 1.0 }),
                        signal: controller2.signal
                    });
                    clearTimeout(t2);
                    if (!fallbackResponse.ok) throw new Error(`Fallback TTS failed: ${fallbackResponse.status}`);
                    const audioBlob = await fallbackResponse.blob();
                    return await this.playAudioBlob(audioBlob, `${agent} (fallback: ${fallbackVoice})`, { agent, text: speechText });
                }
                throw new Error(`TTS synthesis failed: ${response.status}`);
            }
            // Детекція сервісного «тихого» фолбеку: пропустити відтворення і повторити
            const fb = response.headers.get('X-TTS-Fallback');
            if (fb) {
                this.log(`[VOICE] Server returned fallback audio: ${fb}. ${retryCount < this.voiceSystem.maxRetries ? 'Retrying...' : 'Skipping playback.'}`);
                if (retryCount < this.voiceSystem.maxRetries) {
                    await this.delay(400 * (retryCount + 1));
                    return await this.synthesizeAndPlay(text, agent, retryCount + 1);
                }
                return; // не відтворюємо тишу
            }

            const audioBlob = await response.blob();
            console.log(`[ATLAS-TTS] Received audio blob for ${agent}: size=${audioBlob.size}, type=${audioBlob.type}`);
            
            if (audioBlob.size === 0) {
                console.error(`[ATLAS-TTS] Empty audio blob received for ${agent}`);
                throw new Error('Empty audio blob received');
            }
            
            await this.playAudioBlob(audioBlob, `${agent} (${voice})`, { agent, text: speechText });
            
        } catch (error) {
            const agentConfig = this.voiceSystem.agents[agent] || this.voiceSystem.agents.atlas;
            
            // Покращена обробка різних типів помилок
            let errorType = 'unknown';
            if (error.name === 'AbortError') {
                errorType = 'timeout';
            } else if (/network|fetch|Failed to fetch|NetworkError/i.test(error.message)) {
                errorType = 'network';
            } else if (error.message.includes('502')) {
                errorType = 'server_error';
            }
            
            this.log(`[VOICE] TTS ${errorType} error (attempt ${retryCount + 1}/${this.voiceSystem.maxRetries + 1}): ${error.message}`);
            
            // Ретраї незалежно від noFallback, але без зміни голосу
            if (retryCount < this.voiceSystem.maxRetries && ['timeout', 'network', 'server_error'].includes(errorType)) {
                const delayMs = Math.min(1000 * (retryCount + 1), 5000); // Прогресивна затримка: 1с, 2с, 3с, 4с
                this.log(`[VOICE] Retrying TTS in ${delayMs}ms...`);
                await this.delay(delayMs);
                return await this.synthesizeAndPlay(text, agent, retryCount + 1);
            }
            // Фолбек у Web Speech вимкнено за замовчуванням (можна ввімкнути через allowWebSpeechFallback)
            if (this.voiceSystem.allowWebSpeechFallback && !agentConfig.noFallback) {
                await this.fallbackToWebSpeech(text, agent);
            } else {
                this.log(`[VOICE] Voice synthesis failed without fallback: ${error.message}`);
            }
        }
    }

    // Витягує стисле ТТС-представлення звіту Тетяни: РЕЗЮМЕ + СТАТУС (і, за можливості, короткий підсумок кроків)
    summarizeTetianaForTTS(text) {
        const src = String(text || '');
        const lines = src.split(/\n+/);
        let resume = '';
        let status = '';
        const steps = [];
        let inSteps = false;
        for (const raw of lines) {
            const line = raw.trim();
            if (!line) continue;
            if (/^\s*РЕЗЮМЕ\b/i.test(line)) {
                resume = line.replace(/^\s*РЕЗЮМЕ\s*:?/i, '').trim();
                inSteps = false;
                continue;
            }
            if (/^\s*СТАТУС\b/i.test(line)) {
                status = line.replace(/^\s*СТАТУС\s*:?/i, '').trim();
                inSteps = false;
                continue;
            }
            if (/^\s*КРОКИ\b/i.test(line)) { inSteps = true; continue; }
            if (inSteps) {
                const item = line.replace(/^\d+\)\s*|^[-•]\s*/,'').trim();
                if (item) steps.push(item);
                if (steps.length >= 2) inSteps = false; // беремо до двох пунктів для стиснення
            }
        }
        const parts = [];
        if (resume) parts.push(resume);
        if (steps.length) parts.push(`Кроки: ${steps.slice(0,2).join('; ')}`);
        if (status) parts.push(`Статус: ${status}`);
        return parts.join('. ').trim().slice(0, 300);
    }
    
    async playAudioBlob(audioBlob, description, meta = {}) {
        return new Promise((resolve, reject) => {
            try {
                console.log(`[ATLAS-TTS] Playing audio blob: ${description}, size=${audioBlob.size}, type=${audioBlob.type}`);
                const audioUrl = URL.createObjectURL(audioBlob);
                console.log(`[ATLAS-TTS] Created audio URL: ${audioUrl}`);
                const audio = new Audio(audioUrl);
                audio.preload = 'auto';
                audio.playsInline = true;
                audio.muted = true; // стартуем в mute для обхода автоплея
                this.voiceSystem.currentAudio = audio;
                const agent = meta.agent || 'atlas';
                const text = meta.text || '';
                
                // Підсвічування
                let speakingEl = null;
                try {
                    const messages = this.chatContainer.querySelectorAll(`.message.assistant.agent-${agent}`);
                    if (messages && messages.length > 0) {
                        speakingEl = messages[messages.length - 1];
                        speakingEl.classList.add('speaking');
                    }
                } catch (_) {}
                
                const cleanup = () => {
                    URL.revokeObjectURL(audioUrl);
                    this.voiceSystem.currentAudio = null;
                    if (speakingEl) speakingEl.classList.remove('speaking');
                };

                const tryUnmute = () => {
                    // Снимаем mute спустя мгновение после старта, когда браузер уже разрешил воспроизведение
                    setTimeout(() => {
                        try { audio.muted = false; } catch (_) {}
                    }, 150);
                };

                audio.onended = () => {
                    cleanup();
                    this.voiceSystem.lastAgentComplete = Date.now();
                    this.log(`[VOICE] Finished playing ${description}`);
                    
                    try {
                        if (this.ttsSync.dispatchEvents) {
                            window.dispatchEvent(new CustomEvent('atlas-tts-ended', { detail: { agent, text } }));
                        }
                        this.ttsSync.onTTSEnd();
                    } catch (_) {}
                    
                    // Check if input should be unlocked after TTS completes
                    this.checkAndUnlockInput();
                    
                    // Process next TTS in queue if available
                    if (this.voiceSystem.ttsQueue.length > 0 && !this.voiceSystem.isProcessingTTS) {
                        setTimeout(() => this.processTTSQueue(), 100);
                    }
                    
                    resolve();
                };
                
                audio.onerror = (error) => {
                    console.error(`[ATLAS-TTS] Audio error for ${description}:`, error);
                    console.error(`[ATLAS-TTS] Audio error details:`, {
                        src: audio.src,
                        readyState: audio.readyState,
                        networkState: audio.networkState,
                        error: audio.error
                    });
                    this.log(`[VOICE] Audio playback error: ${error}`);
                    cleanup();
                    reject(error);
                };
                
                audio.oncanplay = () => {
                    console.log(`[ATLAS-TTS] Audio can play: ${description}, duration=${audio.duration?.toFixed(1) || 'unknown'}s`);
                    this.log(`[VOICE] Starting playback of ${description} (duration: ${audio.duration?.toFixed(1) || 'unknown'}s)`);
                    // show first subtitle chunk (approx) if provided
                    if (text) {
                        const approxFirst = this.segmentForTTS(text, agent)[0] || '';
                        if (approxFirst) this.showSubtitles(approxFirst);
                    }
                };
                
                audio.onplaying = () => {
                    console.log(`[ATLAS-TTS] Audio is playing: ${description}`);
                    // Как только пошло воспроизведение — пробуем снять mute
                    tryUnmute();
                    // schedule mid-subtitle update
                    if (text) {
                        const segs = this.segmentForTTS(text, agent);
                        if (segs.length > 1) {
                            const mid = Math.floor(Math.min(segs.length - 1, 1));
                            setTimeout(() => this.showSubtitles(segs[mid]), Math.max(800, (audio.duration || 2) * 500));
                        }
                    }
                };
                
                audio.play().then(() => {
                    this.log(`[VOICE] Playing ${description} (muted autoplay)`);
                    try {
                        if (this.ttsSync.dispatchEvents) {
                            window.dispatchEvent(new CustomEvent('atlas-tts-started', { detail: { agent, text } }));
                        }
                        this.ttsSync.onTTSStart();
                    } catch (_) {}
                    if (this.ttsSync.blockNextMessageUntilTTSComplete) {
                        this.setInputState(false);
                    }
                }).catch(err => {
                    // Блокування автоплею — баннер для клика
                    if (err && (err.name === 'NotAllowedError' || /play\(\) failed because the user didn't interact/i.test(err.message))) {
                        let banner = document.getElementById('atlas-audio-unlock');
                        if (!banner) {
                            banner = document.createElement('div');
                            banner.id = 'atlas-audio-unlock';
                            document.body.appendChild(banner);
                            (function(b){
                                b.style.position='fixed'; b.style.left='50%'; b.style.bottom='16px'; b.style.transform='translateX(-50%)';
                                b.style.background='rgba(0,0,0,0.85)'; b.style.color='#fff'; b.style.padding='10px 14px';
                                b.style.borderRadius='8px'; b.style.fontFamily='system-ui,sans-serif'; b.style.fontSize='14px';
                                b.style.zIndex='9999'; b.style.cursor='pointer'; b.textContent='Клікніть, щоб увімкнути звук';
                            })(banner);
                        }
                        const tryPlay = () => {
                            audio.muted = false;
                            audio.play().then(() => {
                                this.log('[VOICE] Audio unlocked by user gesture');
                                banner.remove();
                            }).catch(e => this.log(`[VOICE] Still blocked: ${e?.message || e}`));
                        };
                        banner.onclick = tryPlay;
                    } else {
                        reject(err);
                    }
                });
                
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Fallback to browser's Web Speech API
    async fallbackToWebSpeech(text, agent) {
        if (!('speechSynthesis' in window)) {
            this.log('[VOICE] No speech synthesis available');
            return;
        }
        
        try {
            const utterance = new SpeechSynthesisUtterance(text);
            const agentConfig = this.voiceSystem.agents[agent] || this.voiceSystem.agents.atlas;
            
            // Configure voice parameters based on agent
            utterance.pitch = agentConfig.pitch || 1.0;
            utterance.rate = agentConfig.rate || 1.0;
            utterance.volume = 0.9;
            utterance.lang = 'uk-UA';
            
            // Try to find a suitable voice
            const voices = speechSynthesis.getVoices();
            const ukrainianVoice = voices.find(v => (v.lang || '').toLowerCase().includes('uk') || (v.name || '').toLowerCase().includes('ukrainian'));
            const englishVoice = voices.find(v => (v.lang || '').toLowerCase().includes('en'));
            
            if (ukrainianVoice) {
                utterance.voice = ukrainianVoice;
            } else if (englishVoice) {
                utterance.voice = englishVoice;
            }
            
            utterance.onstart = () => {
                this.log(`[VOICE] Playing ${agent} with Web Speech API (${utterance.voice?.name || 'default'}, ${utterance.lang})`);
            };
            
            utterance.onerror = (error) => {
                this.log(`[VOICE] Web Speech error: ${error.error}`);
            };
            
            speechSynthesis.speak(utterance);
            
        } catch (error) {
            this.log(`[VOICE] Web Speech fallback failed: ${error.message}`);
        }
    }
    
    addVoiceMessage(text, agent, signature) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message assistant agent-${agent}`;
        
        const agentConfig = this.voiceSystem.agents[agent];
        const color = agentConfig ? agentConfig.color : '#00ff00';
    const displaySignature = signature || (agentConfig && agentConfig.signature) || `[${agent.toUpperCase()}]`;
        
    // Видимий лейбл спікера
    const labelDiv = document.createElement('div');
    labelDiv.className = 'agent-label';
    labelDiv.textContent = displaySignature;
    labelDiv.style.fontWeight = '600';
    labelDiv.style.fontFamily = 'monospace';
    labelDiv.style.color = color;
    labelDiv.style.marginBottom = '4px';
        
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = this.formatMessage(text);
    // Убираем инлайн-линию: вертикальная линия уже рисуется через CSS ::before
        
    messageDiv.appendChild(labelDiv);
    messageDiv.appendChild(textDiv);
    this.chatContainer.appendChild(messageDiv);
    this.scrollToBottomIfNeeded(false); // agent messages always scroll to bottom
        
        // Додаємо до списку повідомлень
        this.messages.push({
            text: text,
            type: 'assistant',
            agent: agent,
            signature: signature,
            timestamp: new Date()
        });
    }
    
    addMessage(text, type = 'user') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = this.formatMessage(text);
        
        messageDiv.appendChild(textDiv);
    this.chatContainer.appendChild(messageDiv);
    this.scrollToBottomIfNeeded();
        
        this.messages.push({
            text: text,
            type: type,
            timestamp: new Date()
        });
    }
    
    updateCurrentAgent(agent) {
        const agentIndicator = document.getElementById('agent-name');
        if (agentIndicator) {
            const agentConfig = this.voiceSystem.agents[agent];
            agentIndicator.textContent = agent.toUpperCase();
            agentIndicator.style.color = agentConfig ? agentConfig.color : '#00ff00';
        }
    }
    
    formatMessage(text) {
        let processed = text || '';
        
        // 1. Прибираємо дублювання агентів на початку
        processed = processed.replace(/^\s*\[(?:ATLAS|АТЛАС|ТЕТЯНА|TETYANA|ГРИША|GRISHA)\]\s*/i, '')
                            .replace(/^\s*(?:ATLAS|АТЛАС|ТЕТЯНА|TETYANA|ГРИША|GRISHA)\s*:\s*/i, '');
        
        // 2. Прибираємо дублювання агентів після переносу рядка 
        processed = processed.replace(/\n\s*\[(?:ATLAS|АТЛАС|ТЕТЯНА|TETYANA|ГРИША|GRISHA)\]\s*/gi, '\n')
                            .replace(/\n\s*(?:ATLAS|АТЛАС|ТЕТЯНА|TETYANA|ГРИША|GRISHA)\s*:\s*/gi, '\n');
        
        // 3. Прибираємо всі решітки з заголовків (####, ###, ##, #)
        processed = processed.replace(/^####\s+(.+)$/gm, '**$1**')  // #### текст -> **текст**
                            .replace(/^###\s+(.+)$/gm, '**$1**')   // ### текст -> **текст**
                            .replace(/^##\s+(.+)$/gm, '**$1**')    // ## текст -> **текст**
                            .replace(/^#\s+(.+)$/gm, '**$1**');    // # текст -> **текст**
        
        // 4. Прибираємо зайві решітки, що залишились посеред тексту
        processed = processed.replace(/####\s*/g, '')  // прибираємо #### посеред тексту
                            .replace(/###\s*/g, '')   // прибираємо ### посеред тексту
                            .replace(/##\s*/g, '')    // прибираємо ## посеред тексту
                            .replace(/#\s+/g, '');    // прибираємо # + пробіл посеред тексту
        
        // 5. Робимо компактніше: зменшуємо кількість порожніх рядків
        processed = processed.replace(/\n\s*\n\s*\n/g, '\n\n') // 3+ порожніх -> 2
                            .replace(/^\s*\n+/, '')              // прибираємо порожні рядки на початку
                            .replace(/\n+\s*$/, '');             // прибираємо порожні рядки в кінці
        
        // 6. Форматування для HTML
        return processed.replace(/\n/g, '<br>')
                       .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'); // **текст** -> <strong>текст</strong>
    }
    
    toggleVoice() {
        const voiceButton = document.getElementById('voice-toggle');
        if (this.voiceSystem.enabled) {
            // Toggle voice playback
            const isEnabled = this.isVoiceEnabled();
            this.setVoiceEnabled(!isEnabled);
            
            voiceButton.innerHTML = this.isVoiceEnabled() ? '🔊' : '🔇';
            voiceButton.title = this.isVoiceEnabled() ? 'Disable voice' : 'Enable voice';
            
            this.log(`[VOICE] Voice playback ${this.isVoiceEnabled() ? 'enabled' : 'disabled'}`);
        }
    }
    
    isVoiceEnabled() {
        return localStorage.getItem('atlas_voice_enabled') !== 'false';
    }
    
    setVoiceEnabled(enabled) {
        localStorage.setItem('atlas_voice_enabled', enabled ? 'true' : 'false');
    }
    
    setInputState(enabled) {
        if (this.chatInput) {
            this.chatInput.disabled = !enabled;
            this.chatInput.placeholder = enabled ? 'Введіть повідомлення...' : 'Обробляється...';
        }
        if (this.chatButton) {
            this.chatButton.disabled = !enabled;
        }
        
        if (enabled) {
            setTimeout(() => {
                if (this.chatInput && !this.chatInput.disabled) {
                    this.chatInput.focus();
                }
            }, 100);
        }
    }
    
    checkAndUnlockInput() {
        if (this.chatInput && this.chatInput.disabled && !this.isStreaming) {
            this.log('[CHAT] Force unlocking input (safety check)');
            this.setInputState(true);
        }
    }
    
    scrollToBottom() {
        if (this.chatContainer) {
            this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        }
    }

    setupAutoScroll() {
        if (!this.chatContainer) return;
        this.autoScrollEnabled = true;
        const container = this.chatContainer;
        const recompute = () => {
            const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            // Автоскролл включен ТОЛЬКО когда реально у самого низа (<=5px)
            this.autoScrollEnabled = distanceToBottom <= 5;
        };
        // первинна ініціалізація
        setTimeout(recompute, 0);
        container.addEventListener('scroll', recompute);
        window.addEventListener('resize', recompute);

        // При явном взаимодействии пользователя — отключаем автоскролл до возврата к низу
        const disableOnUserIntent = () => {
            const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            if (distanceToBottom > 0) this.autoScrollEnabled = false;
        };
        container.addEventListener('wheel', disableOnUserIntent, { passive: true });
        container.addEventListener('touchstart', disableOnUserIntent, { passive: true });
    }

    scrollToBottomIfNeeded(force = false) {
        if (!this.chatContainer) return;
        if (force || this.autoScrollEnabled) {
            try {
                this.chatContainer.scrollTo({ top: this.chatContainer.scrollHeight, behavior: 'smooth' });
            } catch (_) {
                this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
            }
        }
    }
    
    getSessionId() {
        let sessionId = sessionStorage.getItem('atlas_session_id');
        if (!sessionId) {
            sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            sessionStorage.setItem('atlas_session_id', sessionId);
        }
        return sessionId;
    }
    
    log(message) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${message}`);
        
        if (window.atlasLogger) {
            window.atlasLogger.log(message);
        }
    }

    // ========== STT (Speech-to-Text) System ==========

    async initSpeechSystem() {
        try {
            // Check if Web Speech API is available
            if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
                this.log('[STT] Web Speech API not available');
                return;
            }

            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            this.speechSystem.recognition = new SpeechRecognition();
            
            // Configure recognition
            this.speechSystem.recognition.continuous = this.speechSystem.continuous;
            this.speechSystem.recognition.interimResults = this.speechSystem.interimResults;
            this.speechSystem.recognition.lang = this.speechSystem.language;
            
            // Set up event handlers
            this.setupSpeechEventHandlers();
            
            // Add speech controls to UI
            this.addSpeechControls();
            
            this.speechSystem.enabled = true;
            this.log('[STT] Speech recognition system initialized');
            
        } catch (error) {
            this.log(`[STT] Failed to initialize speech system: ${error.message}`);
            this.speechSystem.enabled = false;
        }
    }

    setupSpeechEventHandlers() {
        const recognition = this.speechSystem.recognition;
        if (!recognition) return;

        recognition.onstart = () => {
            this.speechSystem.isListening = true;
            this.updateSpeechButton();
            this.log('[STT] Speech recognition started');
        };

        recognition.onend = () => {
            this.speechSystem.isListening = false;
            this.updateSpeechButton();
            this.log('[STT] Speech recognition ended');
            
            // Only auto-restart if enabled AND no permission error
            if (this.speechSystem.isEnabled && !this.speechSystem.isListening && !this.speechSystem.permissionDenied) {
                setTimeout(() => this.startSpeechRecognition(), 1000);
            }
        };

        recognition.onerror = (event) => {
            this.log(`[STT] Speech recognition error: ${event.error}`);
            this.speechSystem.isListening = false;
            
            // If permission denied, disable auto-restart
            if (event.error === 'not-allowed') {
                this.speechSystem.permissionDenied = true;
                this.speechSystem.isEnabled = false;
                this.log('[STT] Microphone permission denied. STT disabled.');
            }
            
            this.updateSpeechButton();
        };

        recognition.onresult = (event) => {
            this.handleSpeechResult(event);
        };
    }

    async handleSpeechResult(event) {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            const transcript = result[0].transcript.trim();
            const confidence = result[0].confidence || 0;
            
            this.log(`[STT] Recognized: "${transcript}" (confidence: ${confidence.toFixed(2)})`);
            
            // Show interim speech display for all recognition results
            this.showInterimSpeech(transcript);
            
            if (result.isFinal && confidence > this.speechSystem.confidenceThreshold) {
                await this.processSpeechInput(transcript, confidence);
                // Hide interim display after processing final result
                this.hideInterimSpeech();
            }
        }
    }

    async processSpeechInput(transcript, confidence) {
        const lowerTranscript = transcript.toLowerCase();
        
        this.log(`[STT] Processing speech input: "${transcript}" (lowercase: "${lowerTranscript}")`);
        
        // Check for interruption keywords
        const isInterruption = this.speechSystem.interruptionKeywords.some(
            keyword => lowerTranscript.includes(keyword)
        );
        
        // Check for command authority keywords
        const isCommand = this.speechSystem.commandKeywords.some(
            keyword => lowerTranscript.includes(keyword)
        );

        this.log(`[STT] Classification - isInterruption: ${isInterruption}, isCommand: ${isCommand}`);

        if (isInterruption || isCommand) {
            this.log(`[STT] ${isCommand ? 'Command' : 'Interruption'} detected: "${transcript}"`);
            
            // Stop current TTS if playing
            if (this.voiceSystem.currentAudio && !this.voiceSystem.currentAudio.paused) {
                this.voiceSystem.currentAudio.pause();
                this.log('[STT] Stopped current TTS due to interruption');
            }
            
            // Clear TTS queue
            this.voiceSystem.ttsQueue = [];
            this.voiceSystem.isProcessingTTS = false;
            
            // Send interruption to backend
            try {
                const response = await fetch(`${this.frontendBase}/api/voice/interrupt`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        transcript: transcript,
                        confidence: confidence,
                        sessionId: this.getSessionId(),
                        type: isCommand ? 'command' : 'interruption'
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.log(`[STT] Interruption processed: ${data.action}`);
                    
                    if (data.response && data.response.success) {
                        // Handle response from agents
                        this.handleInterruptionResponse(data.response);
                    }
                }
                
            } catch (error) {
                this.log(`[STT] Failed to process interruption: ${error.message}`);
            }
            
            // Add visual feedback for interruption
            this.addInterruptionMessage(transcript, isCommand ? 'command' : 'interruption');
        } else {
            // Normal speech input - send to chat
            this.log(`[STT] Speech input: "${transcript}" (confidence: ${confidence.toFixed(2)})`);
            await this.sendSpeechToChat(transcript, confidence);
        }
    }

    async sendSpeechToChat(transcript, confidence) {
        this.log(`[STT] Attempting to send speech to chat: "${transcript}"`);
        
        // Check if transcript is not empty
        if (!transcript || transcript.trim().length === 0) {
            this.log('[STT] Empty transcript, not sending to chat');
            return;
        }
        
        // Fill the chat input with recognized text
        const chatInput = document.getElementById('message-input');
        if (chatInput) {
            chatInput.value = transcript.trim();
            this.log(`[STT] Text filled in chat input: "${transcript.trim()}"`);
            
            try {
                // Trigger send automatically
                await this.sendMessage();
                this.log(`[STT] Message sent to chat automatically`);
            } catch (error) {
                this.log(`[STT] Error sending message: ${error.message}`);
            }
        } else {
            this.log(`[STT] Chat input element not found (looking for 'message-input')`);
            // Try to find any input element as fallback
            const allInputs = document.querySelectorAll('input[type="text"], input:not([type])');
            this.log(`[STT] Found ${allInputs.length} input elements on page`);
            for (let i = 0; i < allInputs.length; i++) {
                this.log(`[STT] Input ${i}: id="${allInputs[i].id}", placeholder="${allInputs[i].placeholder}"`);
            }
        }
    }

    handleInterruptionResponse(response) {
        // Handle different types of responses from the agent system
        if (response.shouldPause) {
            this.log('[STT] System paused by user command');
            this.setInputState(true);
        }
        
        if (response.shouldContinue) {
            this.log('[STT] System continuing after user intervention');
        }
        
        if (response.response && Array.isArray(response.response)) {
            // Process agent responses
            response.response.forEach(agentResponse => {
                if (agentResponse.content) {
                    this.addVoiceMessage(agentResponse.content, 
                                       agentResponse.agent || 'atlas',
                                       agentResponse.signature);
                }
            });
        }
    }

    addInterruptionMessage(transcript, type) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message user interruption ${type}`;
        
        const iconDiv = document.createElement('div');
        iconDiv.className = 'interruption-icon';
        iconDiv.innerHTML = type === 'command' ? '👑' : '✋';
        iconDiv.style.marginRight = '10px';
        iconDiv.style.fontSize = '18px';
        
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = `<strong>${type === 'command' ? 'КОМАНДА' : 'ПЕРЕБИВАННЯ'}:</strong> ${transcript}`;
        textDiv.style.color = type === 'command' ? '#ffd700' : '#ff6b6b';
        
        messageDiv.appendChild(iconDiv);
        messageDiv.appendChild(textDiv);
    this.chatContainer.appendChild(messageDiv);
    this.scrollToBottomIfNeeded(true);
    }

    showInterimSpeech(transcript) {
        let interimDiv = document.getElementById('interim-speech');
        
        if (!interimDiv) {
            interimDiv = document.createElement('div');
            interimDiv.id = 'interim-speech';
            interimDiv.className = 'interim-speech';
            interimDiv.style.cssText = `
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                background: rgba(0, 0, 0, 0.9);
                border: 2px solid #00ff7f;
                padding: 30px 40px;
                border-radius: 10px;
                font-family: 'Courier New', monospace;
                color: #00ff7f;
                z-index: 10000;
                font-size: 24px;
                text-align: center;
                min-width: 50%;
                max-width: 80%;
                backdrop-filter: blur(10px);
                box-shadow: 0 0 20px rgba(0, 255, 127, 0.3);
                text-shadow: 0 0 5px rgba(0, 255, 127, 0.5);
                animation: pulse-border 2s infinite;
            `;
            
            // Add CSS animation for border pulsing
            if (!document.getElementById('stt-animation-style')) {
                const style = document.createElement('style');
                style.id = 'stt-animation-style';
                style.textContent = `
                    @keyframes pulse-border {
                        0%, 100% { border-color: #00ff7f; }
                        50% { border-color: #00ff41; }
                    }
                `;
                document.head.appendChild(style);
            }
            
            document.body.appendChild(interimDiv);
        }
        
        interimDiv.innerHTML = `
            <div style="font-size: 16px; margin-bottom: 10px; opacity: 0.8;">🎤 ПРОСЛУХОВУЄМО</div>
            <div style="font-weight: bold;">${transcript}</div>
            <div style="font-size: 12px; margin-top: 10px; opacity: 0.6;">Продовжуйте говорити або зачекайте для відправки...</div>
        `;
        
        // Clear interim display after 3 seconds of no updates
        clearTimeout(this.interimTimeout);
        this.interimTimeout = setTimeout(() => {
            if (interimDiv && interimDiv.parentNode) {
                interimDiv.parentNode.removeChild(interimDiv);
            }
        }, 3000);
    }

    hideInterimSpeech() {
        const interimDiv = document.getElementById('interim-speech');
        if (interimDiv && interimDiv.parentNode) {
            interimDiv.parentNode.removeChild(interimDiv);
            this.log('[STT] Interim speech display hidden');
        }
        // Clear any pending timeout
        if (this.interimTimeout) {
            clearTimeout(this.interimTimeout);
            this.interimTimeout = null;
        }
    }

    addSpeechControls() {
        // Use existing microphone button instead of creating new one
        const microphoneBtn = document.getElementById('microphone-btn');
        if (microphoneBtn) {
            microphoneBtn.onclick = () => this.toggleSpeechRecognition();
            microphoneBtn.title = 'Речевий ввід (натисніть для запуску/зупинки STT)';
            this.log('[STT] Speech controls initialized with existing microphone button');
        } else {
            this.log('[STT] Warning: microphone button not found');
        }
    }

    toggleSpeechRecognition() {
        if (!this.speechSystem.enabled) {
            this.log('[STT] Speech system not available');
            return;
        }
        
        if (this.speechSystem.isEnabled) {
            this.stopSpeechRecognition();
        } else {
            this.startSpeechRecognition();
        }
    }

    startSpeechRecognition() {
        if (!this.speechSystem.enabled || !this.speechSystem.recognition) {
            return;
        }
        
        try {
            this.speechSystem.isEnabled = true;
            this.speechSystem.recognition.start();
            this.log('[STT] Speech recognition started - listening for interruptions');
            this.updateSpeechButton();
        } catch (error) {
            this.log(`[STT] Failed to start speech recognition: ${error.message}`);
        }
    }

    stopSpeechRecognition() {
        if (this.speechSystem.recognition) {
            this.speechSystem.isEnabled = false;
            this.speechSystem.recognition.stop();
            this.log('[STT] Speech recognition stopped');
            this.updateSpeechButton();
        }
    }

    updateSpeechButton() {
        const microphoneBtn = document.getElementById('microphone-btn');
        const micBtnText = microphoneBtn?.querySelector('.btn-text');
        
        if (microphoneBtn && micBtnText) {
            if (this.speechSystem.isListening) {
                micBtnText.textContent = '🔴 Слухаю'; // Red dot indicates active listening
                microphoneBtn.style.background = 'rgba(255, 0, 0, 0.4)';
                microphoneBtn.title = 'Прослуховуємо... (натисніть для зупинки)';
                microphoneBtn.classList.add('listening');
            } else if (this.speechSystem.isEnabled) {
                micBtnText.textContent = '🟢 Мікрофон'; // Green dot indicates ready
                microphoneBtn.style.background = 'rgba(0, 255, 0, 0.4)';
                microphoneBtn.title = 'Речевий ввід готовий (натисніть для вимкнення)';
                microphoneBtn.classList.remove('listening');
            } else {
                micBtnText.textContent = '🎤 Мікрофон';
                microphoneBtn.style.background = 'rgba(0, 20, 10, 0.6)';
                microphoneBtn.title = 'Речевий ввід вимкнений (натисніть для ввімкнення)';
                microphoneBtn.classList.remove('listening');
            }
        }
    }
}

// Ініціалізуємо глобальний менеджер чату
window.AtlasChatManager = AtlasIntelligentChatManager;

// helper maps agent name to UI role label
function agentLabel(agent) {
    const a = (agent || '').toLowerCase();
    if (a.includes('grisha')) return 'grisha';
    if (a.includes('tetiana') || a.includes('tetyana') || a.includes('goose')) return 'tetyana';
    if (a.includes('atlas')) return 'assistant';
    return 'assistant';
}

// Canonicalize agent names from SSE events to voice system keys
AtlasIntelligentChatManager.prototype.getCanonicalAgentName = function(agent) {
    const a = String(agent || '').toLowerCase();
    if (a.includes('grisha')) return 'grisha';
    if (a.includes('tetiana') || a.includes('tetyana') || a.includes('goose')) return 'tetyana';
    // default assistant/atlas
    return 'atlas';
};