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
    this.orchestratorBase = (window.ATLAS_CFG && window.ATLAS_CFG.orchestratorBase) || 'http://127.0.0.1:5101';
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

    // Режим озвучування: 'quick' (коротко) або 'standard' (повністю)
    // За замовчуванням — швидкий режим
    this.ttsMode = (localStorage.getItem('atlas_tts_mode') || 'quick').toLowerCase() === 'standard' ? 'standard' : 'quick';
    this.conversationStyle = { liveAddressing: true };

        // STT (Speech-to-Text) system for user interruptions
        this.speechSystem = {
            enabled: false,
            recognition: null,
            wakeRecognition: null,
            isListening: false,
            isEnabled: false,
            permissionDenied: false,
            continuous: true,
            interimResults: true,
            language: 'uk-UA', // Ukrainian as primary
            fallbackLanguage: 'en-US',
            confidenceThreshold: 0.5, // Знижено з 0.7 до 0.5 для кращого розпізнання
            
            // Whisper STT configuration
            preferWhisper: true, // Віддавати перевагу Whisper замість Web Speech API
            whisperAvailable: false,
            recordingTimeout: 10000, // 10 секунд макс. запис для Whisper
            isRecording: false,
            mediaRecorder: null,
            audioChunks: [],

            // One-shot vs wake-word modes
            currentBeamSize: 5, // 5 для одиночного запису ("віспер 5"), 3 для після гарячого слова ("віспер 3")
            wakeModeActive: false,
            resumeWakeAfterTranscribe: false,
            wakeWord: 'атлас',
            wakeWordVariants: ['атлас', 'аталс', 'атласе', 'atlas'],
            _micClickTimer: null,
            
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
        // Phase tracking (pipeline visualization)
        this.phaseMeta = {
            atlas_plan: { label: 'PLAN', color: '#1e90ff' },
            grisha_precheck: { label: 'PRECHECK', color: '#ffd700' },
            execution: { label: 'EXEC', color: '#00ffa5' },
            grisha_verdict: { label: 'VERDICT', color: '#ff8c00' },
            grisha_followup: { label: 'FOLLOW-UP', color: '#ff4d4d' }
        };
        this.lastAgentPhaseKey = new Map();
        this.pipelineState = { order: ['atlas_plan','grisha_precheck','execution','grisha_verdict','grisha_followup'], active: null, seen: new Set() };
        this.buildPipelineHUD();
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
                    
                    // НЕ вмикаємо голосову систему автоматично - користувач сам вирішує
                    if (!localStorage.getItem('atlas_voice_enabled')) {
                        this.setVoiceEnabled(false); // За замовчуванням ВИМКНЕНО
                        this.log('[VOICE] Voice system disabled by default - user can enable manually');
                    }

                    // Відключаємо автоматичну підказку щодо режимів TTS при першому запуску
                    if (!localStorage.getItem('atlas_tts_mode_prompted')) {
                        // Просто відмічаємо що підказка була показана, але не показуємо її автоматично
                        localStorage.setItem('atlas_tts_mode_prompted', 'true');
                        this.log('[VOICE] TTS mode prompting disabled for quiet startup');
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

        // Команди керування режимом озвучування з чату
        if (this.maybeHandleModeCommand && this.maybeHandleModeCommand(message, 'chat')) {
            this.chatInput.value = '';
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
        
        // Extract metadata for evidence and phase display (Phase 2 completion)
        const metadata = {
            evidence: data.evidence,
            phase: data.phase,
            provider: data.provider,
            model: data.model,
            agent: data.agent
        };
        
        if (this.voiceSystem.enabled) {
            // Використовуємо розумну систему визначення агента
            await this.processVoiceResponse(responseText, metadata);
        } else {
            // Відображаємо звичайну відповідь з metadata
            this.addMessage(responseText, 'assistant', metadata);
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
            
            // Send initial user message to Python frontend for intent classification.
            // Python will either handle smalltalk locally or forward to orchestrator.
            const response = await fetch(`${this.frontendBase}/api/chat`, {
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
                    const phase = agentResponse.phase || null;
                    if (phase === 'grisha_verdict' && agentResponse.verification) {
                        this._lastVerdictVerification = agentResponse.verification;
                    }

                    if (this.shouldSkipDuplicatePhase(agent, phase, content)) {
                        this.log(`[PIPELINE] Skipping duplicate phase message: ${agent}:${phase}`);
                        continue;
                    }
                    this.addVoiceMessage(content, agent, signature, phase);
                    
                    // Add to TTS queue if voice is enabled
                    if (this.voiceSystem.enabled && this.isVoiceEnabled() && content.trim()) {
                        if (this.isQuickMode && this.isQuickMode()) {
                            const shortText = this.buildQuickTTS(content, agent);
                            if (shortText) {
                                this.voiceSystem.ttsQueue.push({ text: shortText, agent });
                            } else {
                                const segments = this.segmentForTTS(content, agent);
                                const batched = this.combineSegmentsForAgent(segments, agent);
                                for (const seg of batched) this.voiceSystem.ttsQueue.push({ text: seg, agent });
                            }
                        } else {
                            const segments = this.segmentForTTS(content, agent);
                            const batched = this.combineSegmentsForAgent(segments, agent);
                            for (const seg of batched) this.voiceSystem.ttsQueue.push({ text: seg, agent });
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
                } else if (data.endOfConversation === true) {
                    // No follow-up actions and orchestrator signaled end
                    this.log('[CHAT] Conversation ended by orchestrator');
                    // Optionally show a subtle UI hint
                    try { this.addMessage('— розмову завершено —', 'system'); } catch (_) {}
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
                const phase = agentResponse.phase || null;
                if (phase === 'grisha_verdict' && agentResponse.verification) {
                    this._lastVerdictVerification = agentResponse.verification;
                }
                if (this.shouldSkipDuplicatePhase(agent, phase, content)) {
                    this.log(`[PIPELINE] Skipping duplicate phase message (continue): ${agent}:${phase}`);
                } else {
                    this.addVoiceMessage(content, agent, signature, phase);
                }
                if (this.voiceSystem.enabled && this.isVoiceEnabled() && content.trim()) {
                    if (this.isQuickMode && this.isQuickMode()) {
                        const shortText = this.buildQuickTTS(content, agent);
                        if (shortText) {
                            this.voiceSystem.ttsQueue.push({ text: shortText, agent });
                        } else {
                            const raw = content.replace(/^\[.*?\]\s*/, '');
                            const segs = this.segmentForTTS(raw, agent);
                            const batched = this.combineSegmentsForAgent(segs, agent);
                            for (const seg of batched) this.voiceSystem.ttsQueue.push({ text: seg, agent });
                        }
                    } else {
                        const raw = content.replace(/^\[.*?\]\s*/, '');
                        const segs = this.segmentForTTS(raw, agent);
                        const batched = this.combineSegmentsForAgent(segs, agent);
                        for (const seg of batched) this.voiceSystem.ttsQueue.push({ text: seg, agent });
                    }
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
            } else if (data.endOfConversation === true) {
                this.log('[CHAT] Conversation ended by orchestrator (continue)');
                try { this.addMessage('— розмову завершено —', 'system'); } catch (_) {}
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

    async processVoiceResponse(responseText, metadata = {}) {
        try {
            // Визначаємо агента та підготовляємо відповідь
            const prepareResponse = await fetch(`${this.frontendBase}/api/voice/prepare_response`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: responseText,
                    metadata: metadata
                })
            });
            
            if (prepareResponse.ok) {
                const prepData = await prepareResponse.json();
                if (prepData.success) {
                    // Відображаємо ТІЛЬКИ зміст без лейблу на початку з metadata
                    this.addVoiceMessage(
                        prepData.text,
                        prepData.agent,
                        prepData.signature,
                        metadata.phase,
                        metadata
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
            // Fallback на звичайне відображення з metadata
            this.addMessage(responseText, 'assistant', metadata);
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

    // Побудова короткого тексту для швидкого режиму озвучення
    buildQuickTTS(text, agent = 'atlas') {
        if (!text) return '';
        const a = (agent || 'atlas').toLowerCase();
        let src = String(text);
        // Прибираємо підпис на початку
        src = src.replace(/^\s*\[[^\]]+\]\s*/i, '');
        // Тетяна: спершу [VOICE], далі стисле РЕЗЮМЕ/СТАТУС
        if (a.includes('tet') || a.includes('goose')) {
            const v = this.extractVoiceOnly(src);
            if (v) return v;
            const t = this.summarizeTetianaForTTS(src);
            if (t) return t;
        }
        // Загальна евристика: 1–2 ключові речення або заголовки
        let cleaned = src
            .replace(/^#+\s+/gm, '')
            .replace(/\*\*|__|`/g, '')
            .replace(/\n{2,}/g, '\n')
            .trim();
        const lines = cleaned.split(/\n+/).map(s => s.trim()).filter(Boolean);
        const picked = [];
        const prefer = [/^Суть\b/i, /^Висновок\b/i, /^Статус\b/i, /^План\b/i, /^Кроки\b/i, /^Ризик/i];
        for (const re of prefer) {
            const hit = lines.find(l => re.test(l));
            if (hit) picked.push(hit.replace(/^[^:]+:\s*/, ''));
        }
        if (picked.length < 1) {
            const sentences = cleaned.split(/(?<=[.!?…])\s+/).map(s => s.trim()).filter(Boolean);
            if (sentences[0]) picked.push(sentences[0]);
            if (sentences[1]) picked.push(sentences[1]);
        }
        let result = picked.filter(Boolean).slice(0, 2).join(' ');
        if (!/[А-ЯІЇЄҐа-яіїєґ]/.test(result)) {
            result = this.translateToUAInline(result);
        }
        if (result) {
            // Додамо легке звертання між агентами (без жорсткого шаблону)
            if (this.conversationStyle?.liveAddressing) {
                const pref = (() => {
                    if (a.includes('atlas')) return 'Тетяно, Гриша, ';
                    if (a.includes('grisha')) return 'Атласе, Тетяно, ';
                    if (a.includes('tet') || a.includes('goose')) return 'Атласе, ';
                    return '';
                })();
                result = `${pref}Коротко: ${result}`;
            } else {
                result = `Коротко: ${result}`;
            }
        }
        if (result.length > 240) result = result.slice(0, 240);
        return result;
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
    
    addVoiceMessage(text, agent, signature, phase = null, metadata = {}) {
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
        
        // Inject confidence for verdict if backend provided verification object in recent raw message set
        let effectiveText = text;
        if (phase === 'grisha_verdict' && typeof text === 'string' && !/CONF\s*=\s*\d+\.\d+/.test(text)) {
            // Try to find verification metadata from last raw orchestrator packet (stored earlier in provisional structure if needed)
            // As a lightweight approach, scan last few messages for same phase with confidence attached in content
            const recent = [...this.messages].reverse().find(m => m.phase === 'grisha_verdict' && /CONF\s*=\s*\d+\.\d+/.test(m.text));
            if (recent) {
                // Already present somewhere earlier, we can optionally append summary
            } else if (this._lastVerdictVerification && typeof this._lastVerdictVerification.confidence === 'number') {
                const c = this._lastVerdictVerification.confidence;
                effectiveText += `\nCONF=${c.toFixed(2)}${this._lastVerdictVerification.confirmed? ' (confirmed)':''}`;
            }
        }
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = this.formatMessage(effectiveText);
        
        messageDiv.appendChild(labelDiv);
        messageDiv.appendChild(textDiv);
        
        // Add evidence display if available (Phase 2 completion)
        if (metadata.evidence && this.shouldShowEvidence(metadata.evidence)) {
            const evidenceDiv = this.createEvidenceDisplay(metadata.evidence);
            messageDiv.appendChild(evidenceDiv);
        }
        
        // Phase badge
        if (phase && this.phaseMeta[phase]) {
            const badge = document.createElement('span');
            badge.className = 'phase-badge';
            badge.textContent = this.phaseMeta[phase].label;
            badge.style.cssText = `display:inline-block;margin-left:8px;padding:2px 6px;border-radius:6px;font-size:10px;letter-spacing:.5px;vertical-align:middle;background:${this.phaseMeta[phase].color};color:#052012;font-weight:600;box-shadow:0 0 4px ${this.phaseMeta[phase].color}55;`;
            labelDiv.appendChild(badge);
        }

        this.chatContainer.appendChild(messageDiv);
        this.scrollToBottomIfNeeded(false); // agent messages always scroll to bottom
        
        // Додаємо до списку повідомлень
        this.messages.push({
            text: effectiveText,
            type: 'assistant',
            agent: agent,
            signature: signature,
            timestamp: new Date(),
            phase: phase || null,
            metadata: metadata
        });

        if (phase) {
            try { this.updatePipelineHUD(phase); } catch(_) {}
        }
    }

    shouldSkipDuplicatePhase(agent, phase, content) {
        if (!phase) return false;
        // Only suppress for Grisha precheck duplicates & identical follow-ups
        const key = `${agent}:${phase}`;
        const normalized = String(content).trim().slice(0, 120); // partial hash
        const prev = this.lastAgentPhaseKey.get(key);
        const now = Date.now();
        // keep last content & timestamp
        this.lastAgentPhaseKey.set(key, { content: normalized, ts: now });
        if (!prev) return false;
        // If same short content within 25s -> skip
        if (prev.content === normalized && (now - prev.ts) < 25000) return true;
        return false;
    }

    buildPipelineHUD() {
        try {
            if (document.getElementById('pipeline-hud')) return;
            const hud = document.createElement('div');
            hud.id = 'pipeline-hud';
            // Progress bar container
            const prog = document.createElement('div');
            prog.id = 'pipeline-progress';
            prog.style.cssText = 'position:absolute;left:6px;right:6px;bottom:2px;height:3px;background:rgba(0,255,127,0.08);border-radius:2px;overflow:hidden;';
            const bar = document.createElement('div');
            bar.id = 'pipeline-progress-bar';
            bar.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#00ff9d,#1e90ff);box-shadow:0 0 4px #00ff9dAA;transition:width .4s;';
            prog.appendChild(bar);
            for (let i=0;i<this.pipelineState.order.length;i++) {
                const ph = this.pipelineState.order[i];
                const meta = this.phaseMeta[ph];
                if (!meta) continue;
                const step = document.createElement('div');
                step.className = 'ph-step';
                step.dataset.phase = ph;
                step.textContent = meta.label;
                step.style.color = meta.color;
                if (ph === 'grisha_verdict') {
                    const mini = document.createElement('span');
                    mini.className = 'verdict-mini';
                    mini.style.cssText = 'display:inline-block; margin-left:4px; font-weight:400; font-size:9px; color:#ccc; opacity:.75;';
                    mini.textContent = '';
                    step.appendChild(mini);
                }
                hud.appendChild(step);
                if (i < this.pipelineState.order.length-1) {
                    const sep = document.createElement('div');
                    sep.className='ph-sep';
                    hud.appendChild(sep);
                }
            }
            hud.appendChild(prog);
            document.body.appendChild(hud);
        } catch (e) { this.log('[PIPELINE] HUD build failed: '+e.message); }
    }

    updatePipelineHUD(phase) {
        if (!phase) return;
        if (!this.pipelineState.order.includes(phase)) return;
        this.pipelineState.active = phase;
        this.pipelineState.seen.add(phase);
        const hud = document.getElementById('pipeline-hud');
        if (!hud) return;
        const steps = hud.querySelectorAll('.ph-step');
        steps.forEach(step => {
            const ph = step.dataset.phase;
            step.classList.remove('active','done');
            if (ph === phase) step.classList.add('active');
            else if (this.pipelineState.seen.has(ph)) step.classList.add('done');
        });
        // Progress %
        const idx = this.pipelineState.order.indexOf(phase);
        const total = this.pipelineState.order.length;
        const pct = Math.max(0, Math.min(100, Math.round(((idx+1)/ total)*100)));
        const bar = document.getElementById('pipeline-progress-bar');
        if (bar) bar.style.width = pct + '%';
        // If verdict has verification info in latest messages – update mini tag
        if (phase === 'grisha_verdict') {
            try {
                const recent = [...this.messages].reverse().find(m => m.phase === 'grisha_verdict' && m.agent === 'grisha');
                if (recent && recent.text) {
                    const confMatch = recent.text.match(/CONF\s*=\s*(\d+\.\d+)/i);
                    const conf = confMatch ? parseFloat(confMatch[1]) : null;
                    const mini = hud.querySelector('.ph-step[data-phase="grisha_verdict"] .verdict-mini');
                    if (mini && conf !== null) {
                        mini.textContent = conf.toFixed(2);
                        mini.style.color = conf >= 0.75 ? '#00ffa5' : (conf >= 0.5 ? '#ffd700' : '#ff4d4d');
                    }
                }
            } catch(_) {}
        }
    }
    
    addMessage(text, type = 'user', metadata = {}) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = this.formatMessage(text);
        
        messageDiv.appendChild(textDiv);
        
        // Add evidence display if available (Phase 2 completion)
        if (metadata.evidence && this.shouldShowEvidence(metadata.evidence)) {
            const evidenceDiv = this.createEvidenceDisplay(metadata.evidence);
            messageDiv.appendChild(evidenceDiv);
        }
        
        // Add phase indicator if available
        if (metadata.phase) {
            const phaseDiv = document.createElement('div');
            phaseDiv.className = 'message-phase';
            phaseDiv.textContent = this.formatPhase(metadata.phase);
            messageDiv.appendChild(phaseDiv);
        }
        
        this.chatContainer.appendChild(messageDiv);
        this.scrollToBottomIfNeeded();
        
        this.messages.push({
            text: text,
            type: type,
            timestamp: new Date(),
            metadata: metadata
        });
    }

    shouldShowEvidence(evidence) {
        if (!evidence) return false;
        return evidence.files?.length > 0 || 
               evidence.commands?.length > 0 || 
               evidence.outputs?.length > 0 ||
               (evidence.score && evidence.score > 10);
    }

    createEvidenceDisplay(evidence) {
        const container = document.createElement('div');
        container.className = 'evidence-container';
        
        let hasContent = false;
        
        // Files
        if (evidence.files?.length > 0) {
            const filesDiv = document.createElement('div');
            filesDiv.className = 'evidence-section';
            filesDiv.innerHTML = `
                <div class="evidence-header">📁 Files (${evidence.files.length})</div>
                <div class="evidence-items">
                    ${evidence.files.map(file => `<span class="evidence-file">${this.escapeHtml(file)}</span>`).join('')}
                </div>
            `;
            container.appendChild(filesDiv);
            hasContent = true;
        }
        
        // Commands
        if (evidence.commands?.length > 0) {
            const commandsDiv = document.createElement('div');
            commandsDiv.className = 'evidence-section';
            commandsDiv.innerHTML = `
                <div class="evidence-header">⚡ Commands (${evidence.commands.length})</div>
                <div class="evidence-items">
                    ${evidence.commands.map(cmd => `<code class="evidence-command">${this.escapeHtml(cmd)}</code>`).join('')}
                </div>
            `;
            container.appendChild(commandsDiv);
            hasContent = true;
        }
        
        // Outputs
        if (evidence.outputs?.length > 0) {
            const outputsDiv = document.createElement('div');
            outputsDiv.className = 'evidence-section';
            outputsDiv.innerHTML = `
                <div class="evidence-header">📤 Results (${evidence.outputs.length})</div>
                <div class="evidence-items">
                    ${evidence.outputs.map(output => {
                        const truncated = output.length > 200 ? output.substring(0, 200) + '...' : output;
                        return `<pre class="evidence-output">${this.escapeHtml(truncated)}</pre>`;
                    }).join('')}
                </div>
            `;
            container.appendChild(outputsDiv);
            hasContent = true;
        }
        
        // Evidence score
        if (evidence.score && evidence.score > 0) {
            const scoreDiv = document.createElement('div');
            scoreDiv.className = 'evidence-score';
            scoreDiv.innerHTML = `📊 Evidence Score: ${evidence.score}/100`;
            container.appendChild(scoreDiv);
        }
        
        if (!hasContent) {
            container.style.display = 'none';
        }
        
        return container;
    }

    formatPhase(phase) {
        const phaseNames = {
            'atlas_plan': '📋 Planning',
            'grisha_precheck': '🔍 Pre-check',
            'execution': '⚡ Execution',
            'grisha_verdict': '✅ Verdict',
            'grisha_followup': '❓ Follow-up'
        };
        return phaseNames[phase] || phase;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
            // Check Whisper availability first
            if (this.speechSystem.preferWhisper) {
                await this.checkWhisperAvailability();
            }
            
            // Initialize MediaRecorder for Whisper if available
            if (this.speechSystem.whisperAvailable) {
                await this.initWhisperRecording();
            }
            
            // Fallback to Web Speech API
            if (!this.speechSystem.whisperAvailable || !this.speechSystem.preferWhisper) {
                await this.initWebSpeechAPI();
            }

            // Підготуємо wake-розпізнавання (окремий інстанс)
            await this.initWakeRecognition().catch(() => {});
            
            // Add speech controls to UI
            this.addSpeechControls();
            
            this.speechSystem.enabled = true;
            this.log(`[STT] Speech system initialized (Whisper: ${this.speechSystem.whisperAvailable})`);
            
        } catch (error) {
            this.log(`[STT] Failed to initialize speech system: ${error.message}`);
            this.speechSystem.enabled = false;
        }
    }

    async checkWhisperAvailability() {
        try {
            const response = await fetch(`${this.frontendBase}/api/stt/status`);
            const status = await response.json();
            this.speechSystem.whisperAvailable = status.whisper_available || false;
            this.log(`[STT] Whisper availability: ${this.speechSystem.whisperAvailable}`);
        } catch (error) {
            this.log(`[STT] Failed to check Whisper: ${error.message}`);
            this.speechSystem.whisperAvailable = false;
        }
    }

    async initWhisperRecording() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ 
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                } 
            });
            
            this.speechSystem.mediaRecorder = new MediaRecorder(stream);
            this.speechSystem.audioChunks = [];
            
            this.speechSystem.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.speechSystem.audioChunks.push(event.data);
                }
            };
            
            this.speechSystem.mediaRecorder.onstop = () => {
                this.processWhisperRecording();
            };
            
            this.log('[STT] Whisper recording initialized');
        } catch (error) {
            this.log(`[STT] Failed to initialize Whisper recording: ${error.message}`);
            this.speechSystem.whisperAvailable = false;
        }
    }

    async initWebSpeechAPI() {
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
        
        this.log('[STT] Web Speech API initialized');
    }

    async initWakeRecognition() {
        // Окремий інстанс для режиму «гарячого слова» (щоб не конфліктував із основним розпізнаванням)
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            this.log('[STT] Wake recognition not available (Web Speech API missing)');
            return false;
        }
        try {
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const rec = new SpeechRecognition();
            rec.continuous = true;
            rec.interimResults = false;
            rec.lang = this.speechSystem.language || 'uk-UA';

            rec.onstart = () => this.log('[STT] Wake recognition started (listening for "Атлас")');
            rec.onend = () => {
                this.log('[STT] Wake recognition ended');
                // авто-перезапуск у режимі wake, якщо активний
                if (this.speechSystem.wakeModeActive) {
                    setTimeout(() => { try { rec.start(); } catch(_){} }, 500);
                }
            };
            rec.onerror = (e) => this.log(`[STT] Wake recognition error: ${e.error}`);
            rec.onresult = async (event) => {
                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (!result || result.length === 0) continue;
                    const raw = (result[0].transcript || '').trim();
                    const transcript = raw.toLowerCase();
                    const conf = result[0].confidence || 0;
                    if (!transcript) continue;
                    this.log(`[STT] Wake heard: "${transcript}" (${conf.toFixed(2)})`);

                    const hasWake = this.speechSystem.wakeWordVariants.some(w => transcript.includes(w));
                    if (hasWake && conf > 0.4) {
                        // Якщо фраза містить привітання і одразу команду — беремо хвіст після звернення й відправляємо без підтвердження й без додаткового запису
                        const greetRe = /(привіт|привет|вітаю|здрастуйте|добрий\s+день|добрий\s+вечір|добрий\s+ранок)/i;
                        const wakeRe = /(атлас|аталс|атласе|atlas)/i;
                        const greetPos = raw.search(greetRe);
                        const wakePos = raw.search(wakeRe);
                        let tail = '';
                        if (wakePos !== -1) {
                            // Хвіст після слова «Атлас» або після «привіт Атлас» тощо
                            tail = raw.slice(wakePos + raw.slice(wakePos).match(wakeRe)[0].length).trim();
                            // Прибрати розділові/звертальні частки на початку хвоста
                            tail = tail.replace(/^[,!:\-\s]+/, '').replace(/^(будь\s*ласка|скажи|розкажи|поясни)\s+/i, '');
                        }

                        // Якщо хвіст суттєвий (є змістова частина) — одразу шлемо в чат
                        if (tail && tail.length > 1) {
                            try { rec.stop(); } catch(_) {}
                            this.stopWakeListening();
                            this.log(`[STT] Wake+command inline detected, sending tail: "${tail}"`);
                            await this.sendSpeechToChat(tail, Math.max(conf, 0.85));
                            // Після відправки — залишаємося у wake-режимі й перезапускаємо слухання без озвучки
                            if (this.speechSystem.wakeModeActive) {
                                setTimeout(() => this.startWakeListening(), 300);
                            }
                            break;
                        }

                        // Інакше — звичайний сценарій: підтвердження + одноразовий запис (віспер 3)
                        try { rec.stop(); } catch(_) {}
                        await this.handleWakeWordTriggered();
                        break;
                    }
                }
            };

            this.speechSystem.wakeRecognition = rec;
            return true;
        } catch (e) {
            this.log(`[STT] Failed to init wake recognition: ${e.message}`);
            return false;
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
                // Обробка голосових команд режимів
                if (this.maybeHandleModeCommand && this.maybeHandleModeCommand(transcript, 'stt')) {
                    this.hideInterimSpeech();
                    continue;
                }
                await this.processSpeechInput(transcript, confidence);
                // Hide interim display after processing final result
                this.hideInterimSpeech();
            }
        }
    }

    // ========== Whisper STT Functions ==========

    async processWhisperRecording() {
        try {
            if (this.speechSystem.audioChunks.length === 0) {
                this.log('[STT] No audio data to process');
                return;
            }

            // Create audio blob
            const audioBlob = new Blob(this.speechSystem.audioChunks, { type: 'audio/webm' });
            this.speechSystem.audioChunks = [];

            this.log(`[STT] Processing audio with Whisper (${audioBlob.size} bytes)`);

            // Create form data for upload
            const formData = new FormData();
            formData.append('file', audioBlob, 'recording.webm');
            formData.append('language', 'uk'); // Ukrainian
            const beam = String(this.speechSystem.currentBeamSize || 5);
            formData.append('beam_size', beam);
            formData.append('temperature', '0.0');

            // Send to Whisper endpoint
            const response = await fetch(`${this.frontendBase}/api/stt/transcribe`, {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success && result.text) {
                const transcript = result.text.trim();
                this.log(`[STT] Whisper recognized: "${transcript}" (${result.language})`);
                
                // Show recognized text
                this.showInterimSpeech(transcript);
                
                // Process as speech input
                await this.processSpeechInput(transcript, 0.9); // High confidence for Whisper
                
                // Hide interim display
                this.hideInterimSpeech();

                // Якщо активний сценарій «повернутися у wake-режим» — вмикаємо його знову
                if (this.speechSystem.resumeWakeAfterTranscribe) {
                    this.speechSystem.resumeWakeAfterTranscribe = false;
                    // Відновлюємо стандартний beam для наступних разів
                    this.speechSystem.currentBeamSize = 5;
                    if (this.speechSystem.wakeModeActive) {
                        setTimeout(() => this.startWakeListening(), 400);
                    }
                }
            } else {
                this.log(`[STT] Whisper failed: ${result.error || 'Unknown error'}`);
                
                // Fallback to Web Speech API if available
                if (this.speechSystem.recognition) {
                    this.log('[STT] Falling back to Web Speech API');
                    this.startWebSpeechRecognition();
                }
            }

        } catch (error) {
            this.log(`[STT] Whisper processing error: ${error.message}`);
            
            // Fallback to Web Speech API
            if (this.speechSystem.recognition) {
                this.log('[STT] Falling back to Web Speech API');
                this.startWebSpeechRecognition();
            }
        }
    }

    startWhisperRecording() {
        if (!this.speechSystem.mediaRecorder) {
            this.log('[STT] MediaRecorder not available');
            return false;
        }

        try {
            this.speechSystem.audioChunks = [];
            this.speechSystem.isRecording = true;
            this.speechSystem.isListening = true;
            
            this.speechSystem.mediaRecorder.start();
            this.updateSpeechButton();
            
            this.log('[STT] Started Whisper recording');
            
            // Auto-stop after timeout
            setTimeout(() => {
                if (this.speechSystem.isRecording) {
                    this.stopWhisperRecording();
                }
            }, this.speechSystem.recordingTimeout);
            
            return true;
        } catch (error) {
            this.log(`[STT] Failed to start recording: ${error.message}`);
            this.speechSystem.isRecording = false;
            this.speechSystem.isListening = false;
            this.updateSpeechButton();
            return false;
        }
    }

    stopWhisperRecording() {
        if (!this.speechSystem.mediaRecorder || !this.speechSystem.isRecording) {
            return;
        }

        try {
            this.speechSystem.mediaRecorder.stop();
            this.speechSystem.isRecording = false;
            this.speechSystem.isListening = false;
            this.updateSpeechButton();
            
            this.log('[STT] Stopped Whisper recording');
        } catch (error) {
            this.log(`[STT] Error stopping recording: ${error.message}`);
        }
    }

    startWebSpeechRecognition() {
        if (!this.speechSystem.recognition) {
            this.log('[STT] Web Speech API not available');
            return false;
        }

        try {
            this.speechSystem.recognition.start();
            return true;
        } catch (error) {
            this.log(`[STT] Failed to start Web Speech recognition: ${error.message}`);
            return false;
        }
    }

    // ========== Unified STT Interface ==========

    startSpeechRecognition() {
        if (!this.speechSystem.enabled) {
            this.log('[STT] Speech system disabled');
            return false;
        }

        // Try Whisper first if available and preferred
        if (this.speechSystem.whisperAvailable && this.speechSystem.preferWhisper) {
            return this.startWhisperRecording();
        }
        
        // Fallback to Web Speech API
    return this.startWebSpeechRecognition();
    }

    stopSpeechRecognition() {
        // Stop Whisper recording if active
        if (this.speechSystem.isRecording) {
            this.stopWhisperRecording();
        }
        
        // Stop Web Speech API if active
        if (this.speechSystem.recognition && this.speechSystem.isListening) {
            try {
                this.speechSystem.recognition.stop();
            } catch (error) {
                this.log(`[STT] Error stopping Web Speech: ${error.message}`);
            }
        }
    }

    async processSpeechInput(transcript, confidence) {
        // Якщо активний wake-режим і ми не в фазі «після тригера», ігноруємо випадкові фрази
        if (this.speechSystem.wakeModeActive && !this.speechSystem.resumeWakeAfterTranscribe) {
            const t = String(transcript || '').toLowerCase();
            const isWakeWord = this.speechSystem.wakeWordVariants.some(w => t.includes(w));
            if (!isWakeWord) {
                this.log('[STT] Ignored non-wake phrase during wake mode');
                return;
            }
            // Якщо є звернення + команда в одному реченні — відправляємо лише хвіст
            const raw = String(transcript || '');
            const wakeRe = /(атлас|аталс|атласе|atlas)/i;
            const greetRe = /(привіт|привет|вітаю|здрастуйте|добрий\s+день|добрий\s+вечір|добрий\s+ранок)/i;
            const wakePos = raw.search(wakeRe);
            if (wakePos !== -1) {
                let tail = raw.slice(wakePos + raw.slice(wakePos).match(wakeRe)[0].length).trim();
                tail = tail.replace(/^[,!:\-\s]+/, '').replace(/^(будь\s*ласка|скажи|розкажи|поясни)\s+/i, '');
                if (tail.length > 1) {
                    transcript = tail;
                    this.log(`[STT] Using tail after wake for processing: "${transcript}"`);
                }
            }
        }

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
            // Один/подвійний клік: одиночний — одноразовий запис; подвійний — перехід у режим «Атлас»
            microphoneBtn.onclick = (e) => this._handleMicClick(e);
            microphoneBtn.ondblclick = (e) => this._handleMicDoubleClick(e);
            microphoneBtn.title = '🎤 Один клік — разовий запис; Подвійний — режим "Атлас" (гаряче слово)';
            // Update button state immediately after attaching event
            this.updateSpeechButton();
            this.log('[STT] Speech controls initialized with existing microphone button');
        } else {
            this.log('[STT] Warning: microphone button not found');
        }
    }

    _handleMicClick(e) {
        // Детектор одинарного кліку з невеликою затримкою, щоб відрізнити від doubleclick
        if (this.speechSystem._micClickTimer) return;
        this.speechSystem._micClickTimer = setTimeout(() => {
            this.speechSystem._micClickTimer = null;
            this._performSingleClickAction();
        }, 250);
    }

    _handleMicDoubleClick(e) {
        // Подвійний клік: скасовуємо відкладений single та вмикаємо/вимикаємо wake-режим
        if (this.speechSystem._micClickTimer) {
            clearTimeout(this.speechSystem._micClickTimer);
            this.speechSystem._micClickTimer = null;
        }
        this._toggleWakeMode();
    }

    _performSingleClickAction() {
        // Якщо активний wake-режим — одноклік вимикає його
        if (this.speechSystem.wakeModeActive) {
            this.disableWakeMode(true);
            return;
        }
        // Інакше — запускаємо одноразовий запис через Whisper (beam_size=5)
        this.speechSystem.currentBeamSize = 5;
        if (this.speechSystem.whisperAvailable && this.speechSystem.preferWhisper) {
            this.startWhisperRecording();
        } else {
            // Fallback — звичайне розпізнавання (старт/стоп як один раз)
            if (this.speechSystem.isEnabled) this.stopSpeechRecognition();
            this.startSpeechRecognition();
        }
    }

    _toggleWakeMode() {
        if (this.speechSystem.wakeModeActive) {
            this.disableWakeMode(true);
        } else {
            this.enableWakeMode();
        }
    }

    async enableWakeMode() {
        // Вмикаємо режим «гарячого слова» (Атлас)
        this.speechSystem.wakeModeActive = true;
        // Забороняємо звичайне розпізнавання під час wake-режиму
        if (this.speechSystem.isEnabled) {
            this.stopSpeechRecognition();
        }
        this.speechSystem.isEnabled = false;
        // Гарантуємо наявність wakeRecognition
        if (!this.speechSystem.wakeRecognition) {
            await this.initWakeRecognition();
        }
        // Запускаємо wake-слухання
        this.startWakeListening();
        this.updateSpeechButton();
        this.addMessage('Режим прослуховування «Атлас» увімкнено. Скажіть: «Атлас».', 'system');
    }

    disableWakeMode(showMsg = false) {
        this.speechSystem.wakeModeActive = false;
        this.stopWakeListening();
        this.updateSpeechButton();
        if (showMsg) this.addMessage('Режим прослуховування «Атлас» вимкнено.', 'system');
    }

    startWakeListening() {
        const rec = this.speechSystem.wakeRecognition;
        if (!rec) {
            this.log('[STT] Wake listening unavailable');
            return false;
        }
        try {
            rec.start();
            return true;
        } catch (e) {
            this.log(`[STT] Wake start failed: ${e.message}`);
            return false;
        }
    }

    stopWakeListening() {
        const rec = this.speechSystem.wakeRecognition;
        if (!rec) return;
        try { rec.stop(); } catch(_) {}
    }

    async handleWakeWordTriggered(options = {}) {
        const { silent = false } = options || {};
        // Озвучуємо коротке підтвердження від ATLAS і запускаємо запис (beam_size=3)
        const phrases = [
            'Слухаю, можете говорити.',
            'Так, я уважно слухаю.',
            'Так, Олег Миколайович, творець, я у вашому розпорядженні.'
        ];
        if (!silent) {
            const say = phrases[Math.floor(Math.random()*phrases.length)];
            try {
                await this.synthesizeAndPlay(say, 'atlas');
            } catch(_) {}
        }

        // Після підтвердження — одноразовий запис для запиту користувача (beam_size=3)
        this.speechSystem.currentBeamSize = 3;
        this.speechSystem.resumeWakeAfterTranscribe = true;
        if (this.speechSystem.whisperAvailable && this.speechSystem.preferWhisper) {
            this.startWhisperRecording();
        } else {
            // Якщо Whisper недоступний, переходимо на звичайне розпізнавання одразу як фразу
            this.toggleSpeechRecognition();
        }
    }

    toggleSpeechRecognition() {
        if (!this.speechSystem.enabled) {
            this.log('[STT] Speech system not available');
            return;
        }
        
        // Handle Whisper recording
        if (this.speechSystem.whisperAvailable && this.speechSystem.preferWhisper) {
            if (this.speechSystem.isRecording) {
                this.stopWhisperRecording();
            } else {
                this.startWhisperRecording();
            }
            return;
        }
        
        // Fallback to Web Speech API
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
        // Не запускаємо звичайний режим, якщо активний wake-режим
        if (this.speechSystem.wakeModeActive) {
            this.log('[STT] Suppressing normal recognition while wake mode is active');
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
            // Check if recording with Whisper
            const isRecording = this.speechSystem.isRecording || this.speechSystem.isListening;
            const isEnabled = this.speechSystem.isEnabled || this.speechSystem.whisperAvailable;
            const isWake = this.speechSystem.wakeModeActive;
            
            if (isWake) {
                micBtnText.textContent = '👂 Атлас';
                microphoneBtn.style.background = 'rgba(255, 200, 0, 0.35)';
                microphoneBtn.title = 'Режим «Атлас»: слухаю гаряче слово';
                microphoneBtn.classList.add('listening');
            } else if (isRecording) {
                micBtnText.textContent = '🔴 Слухаю'; // Red dot indicates active listening
                microphoneBtn.style.background = 'rgba(255, 0, 0, 0.4)';
                microphoneBtn.title = 'Прослуховуємо... (натисніть для зупинки)';
                microphoneBtn.classList.add('listening');
            } else if (isEnabled && this.speechSystem.enabled) {
                micBtnText.textContent = '🟢 Мікрофон'; // Green dot indicates ready
                microphoneBtn.style.background = 'rgba(0, 255, 0, 0.4)';
                microphoneBtn.title = 'Речевий ввід готовий (натисніть для запису)';
                microphoneBtn.classList.remove('listening');
            } else {
                micBtnText.textContent = '🎤 Мікрофон';
                microphoneBtn.style.background = 'rgba(0, 20, 10, 0.6)';
                microphoneBtn.title = 'Речевий ввід недоступний або вимкнений';
                microphoneBtn.classList.remove('listening');
            }
        }
    }

    // ====== Режими TTS: довідник і перемикачі ======
    getTTSMode() { return this.ttsMode; }
    isQuickMode() { return this.ttsMode === 'quick'; }
    setTTSMode(mode) {
        const m = (mode || '').toLowerCase();
        if (m !== 'quick' && m !== 'standard') return false;
        this.ttsMode = m;
        localStorage.setItem('atlas_tts_mode', m);
        return true;
    }
    modeStatusText() {
        return this.isQuickMode() ? 'швидкий (короткі озвучки)' : 'стандартний (повні озвучки)';
    }
    maybeHandleModeCommand(text, source = 'chat') {
        if (!text) return false;
        const t = String(text).toLowerCase();
        // Запит статусу
        const isAsk = /(який|яка|which|current|what)\s+(режим|mode)|режим\s*\?/.test(t) || /статус\s+режим(у|а)/.test(t);
        if (isAsk) {
            const msg = `Режим озвучування: ${this.modeStatusText()}. Скажіть/напишіть: "увімкни швидкий режим" або "увімкни стандартний режим".`;
            this.addVoiceMessage(msg, 'atlas', this.voiceSystem.agents.atlas.signature);
            return true;
        }
        // Перемикання на швидкий/стандартний
        const hasSwitchVerb = /(режим|mode|перемкни|увімкни|перейди|switch|set)/.test(t);
        const toQuick = /(швидк|fast|quick)/.test(t) && hasSwitchVerb;
        const toStandard = /(стандартн|повн|детальн|standard)/.test(t) && hasSwitchVerb;
        if (toQuick) {
            this.setTTSMode('quick');
            this.addVoiceMessage('Перемикаюся на швидкий режим озвучування: короткі, збалансовані фрази.', 'atlas', this.voiceSystem.agents.atlas.signature);
            return true;
        }
        if (toStandard) {
            this.setTTSMode('standard');
            this.addVoiceMessage('Перемикаюся на стандартний режим озвучування: повний текст як у чаті.', 'atlas', this.voiceSystem.agents.atlas.signature);
            return true;
        }
        // Розмовні скорочення: "говори коротко/детально"
        if (/говори\s+коротко/.test(t)) { this.setTTSMode('quick'); this.addVoiceMessage('Добре, озвучую коротко.', 'atlas', this.voiceSystem.agents.atlas.signature); return true; }
        if (/говори\s+детально|говори\s+повно/.test(t)) { this.setTTSMode('standard'); this.addVoiceMessage('Гаразд, озвучую повний текст.', 'atlas', this.voiceSystem.agents.atlas.signature); return true; }
        return false;
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