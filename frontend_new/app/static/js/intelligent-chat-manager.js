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
                    voice: 'robot',
                    pitch: 0.9,
                    rate: 1.1,
                    priority: 3 
                }
            },
            currentAudio: null,
            fallbackVoices: ['dmytro', 'oleksa', 'robot'], // Загальний список фолбеків (Тетяна їх не використовує)
            maxRetries: 2,
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
            continuous: true,
            interimResults: true,
            language: 'uk-UA', // Ukrainian as primary
            fallbackLanguage: 'en-US',
            confidenceThreshold: 0.7,
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
            blockNextMessageUntilTTSComplete: true,
            // Диспатчити DOM-події для інтеграції сторонніх модулів (кроки виконання, аналітика)
            dispatchEvents: true,
            // Хуки керування кроками виконання (за потреби заміни цими методами зовні)
            onTTSStart: () => {},
            onTTSEnd: () => {}
        };
        
        this.init();
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
                this.voiceSystem.enabled = data.success;
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
        // Додаємо кнопку управління голосом біля чату
        const voiceButton = document.createElement('button');
        voiceButton.id = 'voice-toggle';
        voiceButton.className = 'voice-control-btn';
        voiceButton.innerHTML = '🔊';
        voiceButton.title = 'Toggle voice responses';
        voiceButton.onclick = () => this.toggleVoice();
        
        // Знаходимо місце для кнопки
        const chatControls = this.chatButton.parentElement;
        if (chatControls) {
            chatControls.appendChild(voiceButton);
        }
        
        // Додаємо індикатор поточного агента
        const agentIndicator = document.createElement('div');
        agentIndicator.id = 'current-agent';
        agentIndicator.className = 'agent-indicator';
        agentIndicator.innerHTML = '<span id="agent-name">ATLAS</span>';
        
        const chatContainer = this.chatContainer.parentElement;
        if (chatContainer) {
            chatContainer.insertBefore(agentIndicator, this.chatContainer);
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
        if (!message || this.isStreaming) {
            return;
        }
        
        // За потреби — чекаємо завершення поточного озвучування перед надсиланням нового повідомлення
        if (this.ttsSync.blockNextMessageUntilTTSComplete) {
            await this.waitForTTSIdle(15000); // м'який таймаут 15с, щоб не блокувати назавжди
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
            this.setInputState(true);
        }
    }

    // Очікувати завершення усіх поточних TTS (поточне відтворення + черга)
    async waitForTTSIdle(timeoutMs = 20000) {
        try {
            const start = Date.now();
            // Швидкий вихід, якщо нічого не відтворюється
            if (!this.voiceSystem.currentAudio && this.voiceSystem.ttsQueue.length === 0) return;
            
            await new Promise(resolve => {
                const check = () => {
                    const idle = (!this.voiceSystem.currentAudio || this.voiceSystem.currentAudio.paused || this.voiceSystem.currentAudio.ended)
                                  && this.voiceSystem.ttsQueue.length === 0;
                    if (idle) return resolve();
                    if (Date.now() - start > timeoutMs) return resolve();
                    setTimeout(check, 200);
                };
                check();
            });
        } catch (_) { /* no-op */ }
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
                        this.voiceSystem.ttsQueue.push({
                            text: content.replace(/^\[.*?\]\s*/, ''), // Remove signature from TTS
                            agent: agent
                        });
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
                    this.voiceSystem.ttsQueue.push({ text: content.replace(/^\[.*?\]\s*/, ''), agent });
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
        this.scrollToBottom();
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

        try {
            while (this.voiceSystem.ttsQueue.length > 0) {
                const ttsItem = this.voiceSystem.ttsQueue.shift();
                
                // Wait for current TTS to finish
                if (this.voiceSystem.currentAudio && !this.voiceSystem.currentAudio.paused) {
                    await new Promise(resolve => {
                        this.voiceSystem.currentAudio.onended = resolve;
                        // Timeout after 30 seconds
                        setTimeout(resolve, 30000);
                    });
                }

                // Synthesize the text
                await this.synthesizeAndPlay(ttsItem.text, ttsItem.agent);
            }
        } catch (error) {
            this.log(`[VOICE] TTS queue processing error: ${error.message}`);
        } finally {
            this.voiceSystem.isProcessingTTS = false;
        }
    }

    async synthesizeAndPlay(text, agent, retryCount = 0) {
        try {
            // Зупиняємо поточне відтворення
            if (this.voiceSystem.currentAudio) {
                this.voiceSystem.currentAudio.pause();
                this.voiceSystem.currentAudio = null;
            }
            
            const agentConfig = this.voiceSystem.agents[agent] || this.voiceSystem.agents.atlas;
            const voice = agentConfig.voice;

            // Для Тетяни озвучуємо лише короткі рядки [VOICE]
            let speechText = text;
            if (agent === 'tetyana') {
                speechText = this.extractVoiceOnly(text);
                if (!speechText || speechText.trim().length === 0) {
                    this.log('[VOICE] Skipping TTS for tetyana: no [VOICE] lines found');
                    return;
                }
            }
            
            this.log(`[VOICE] Synthesizing ${agent} voice with ${voice} (attempt ${retryCount + 1})`);
            
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
                timeout: 15000 // 15 second timeout for TTS
            });
            
            if (!response.ok) {
                // If specific voice fails, try fallback (крім Тетяни)
                if (!agentConfig.noFallback && retryCount < this.voiceSystem.maxRetries) {
                    const fallbackVoice = this.voiceSystem.fallbackVoices[retryCount % this.voiceSystem.fallbackVoices.length];
                    this.log(`[VOICE] Voice synthesis failed, trying fallback: ${fallbackVoice}`);
                    
                    const fallbackResponse = await fetch(`${this.frontendBase}/api/voice/synthesize`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            text: speechText,
                            agent: agent,
                            voice: fallbackVoice,
                            pitch: 1.0,
                            rate: 1.0
                        }),
                        timeout: 15000
                    });
                    
                    if (!fallbackResponse.ok) {
                        throw new Error(`Fallback TTS failed: ${fallbackResponse.status}`);
                    }
                    
                    const audioBlob = await fallbackResponse.blob();
                    return await this.playAudioBlob(audioBlob, `${agent} (fallback: ${fallbackVoice})`);
                } else {
                    throw new Error(`TTS synthesis failed: ${response.status}`);
                }
            }
            
            const audioBlob = await response.blob();
            await this.playAudioBlob(audioBlob, `${agent} (${voice})`, { agent, text: speechText });
            
        } catch (error) {
            const agentConfig = this.voiceSystem.agents[agent] || this.voiceSystem.agents.atlas;
            if (!agentConfig.noFallback && retryCount < this.voiceSystem.maxRetries) {
                this.log(`[VOICE] Synthesis error, retrying: ${error.message}`);
                await this.delay(1000 * (retryCount + 1)); // Progressive delay
                return await this.synthesizeAndPlay(text, agent, retryCount + 1);
            } else {
                this.log(`[VOICE] Voice synthesis failed after retries: ${error.message}`);
                // Без фолбеку для Тетяни: не використовуємо Web Speech
                if (!agentConfig.noFallback) {
                    await this.fallbackToWebSpeech(text, agent);
                }
            }
        }
    }
    
    async playAudioBlob(audioBlob, description, meta = {}) {
        return new Promise((resolve, reject) => {
            try {
                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(audioUrl);
                this.voiceSystem.currentAudio = audio;
                const agent = meta.agent || 'atlas';
                const text = meta.text || '';
                
                // Підсвічуємо останнє повідомлення агента як «озвучується»
                let speakingEl = null;
                try {
                    const messages = this.chatContainer.querySelectorAll(`.message.assistant.agent-${agent}`);
                    if (messages && messages.length > 0) {
                        speakingEl = messages[messages.length - 1];
                        speakingEl.classList.add('speaking');
                    }
                } catch (_) {}
                
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    this.voiceSystem.currentAudio = null;
                    this.voiceSystem.lastAgentComplete = Date.now();
                    this.log(`[VOICE] Finished playing ${description}`);

                    // Знімаємо підсвічування
                    if (speakingEl) speakingEl.classList.remove('speaking');

                    // Подія завершення TTS
                    try {
                        if (this.ttsSync.dispatchEvents) {
                            window.dispatchEvent(new CustomEvent('atlas-tts-ended', { detail: { agent, text } }));
                        }
                        this.ttsSync.onTTSEnd();
                    } catch (_) {}

                    // Розблокування інпуту, якщо був заблокований через TTS
                    this.checkAndUnlockInput();
                    resolve();
                };
                
                audio.onerror = (error) => {
                    this.log(`[VOICE] Audio playback error: ${error}`);
                    URL.revokeObjectURL(audioUrl);
                    this.voiceSystem.currentAudio = null;
                    if (speakingEl) speakingEl.classList.remove('speaking');
                    reject(error);
                };
                
                audio.oncanplay = () => {
                    this.log(`[VOICE] Starting playback of ${description} (duration: ${audio.duration?.toFixed(1) || 'unknown'}s)`);
                };
                
                audio.play().then(() => {
                    this.log(`[VOICE] Playing ${description}`);
                    // Подія старту TTS
                    try {
                        if (this.ttsSync.dispatchEvents) {
                            window.dispatchEvent(new CustomEvent('atlas-tts-started', { detail: { agent, text } }));
                        }
                        this.ttsSync.onTTSStart();
                    } catch (_) {}
                    // Блокуємо ввід, щоб синхронізувати «наступне повідомлення» з озвучуванням
                    if (this.ttsSync.blockNextMessageUntilTTSComplete) {
                        this.setInputState(false);
                    }
                }).catch(reject);
                
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
            utterance.volume = 0.8;
            
            // Try to find a suitable voice
            const voices = speechSynthesis.getVoices();
            const ukrainianVoice = voices.find(v => v.lang.includes('uk') || v.name.includes('Ukrainian'));
            const englishVoice = voices.find(v => v.lang.includes('en'));
            
            if (ukrainianVoice) {
                utterance.voice = ukrainianVoice;
            } else if (englishVoice) {
                utterance.voice = englishVoice;
            }
            
            utterance.onstart = () => {
                this.log(`[VOICE] Playing ${agent} with Web Speech API`);
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
        textDiv.style.borderLeft = `3px solid ${color}`;
        
    messageDiv.appendChild(labelDiv);
    messageDiv.appendChild(textDiv);
        this.chatContainer.appendChild(messageDiv);
        this.scrollToBottom();
        
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
        this.scrollToBottom();
        
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
        // Прибираємо службовий лейбл на початку (напр. [ATLAS] або ATLAS:)
        const stripped = (text || '').replace(/^\s*\[(?:ATLAS|АТЛАС|ТЕТЯНА|TETYANA|ГРИША|GRISHA)\]\s*/i, '')
                                      .replace(/^\s*(?:ATLAS|АТЛАС|ТЕТЯНА|TETYANA|ГРИША|GRISHA)\s*:\s*/i, '');
        // Далі звичайне форматування переносів
        return stripped.replace(/\n/g, '<br>');
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
            
            // Auto-restart if still enabled
            if (this.speechSystem.isEnabled && !this.speechSystem.isListening) {
                setTimeout(() => this.startSpeechRecognition(), 1000);
            }
        };

        recognition.onerror = (event) => {
            this.log(`[STT] Speech recognition error: ${event.error}`);
            this.speechSystem.isListening = false;
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
            
            if (result.isFinal && confidence > this.speechSystem.confidenceThreshold) {
                await this.processSpeechInput(transcript, confidence);
            } else if (!result.isFinal) {
                // Show interim results for feedback
                this.showInterimSpeech(transcript);
            }
        }
    }

    async processSpeechInput(transcript, confidence) {
        const lowerTranscript = transcript.toLowerCase();
        
        // Check for interruption keywords
        const isInterruption = this.speechSystem.interruptionKeywords.some(
            keyword => lowerTranscript.includes(keyword)
        );
        
        // Check for command authority keywords
        const isCommand = this.speechSystem.commandKeywords.some(
            keyword => lowerTranscript.includes(keyword)
        );

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
        this.scrollToBottom();
    }

    showInterimSpeech(transcript) {
        let interimDiv = document.getElementById('interim-speech');
        
        if (!interimDiv) {
            interimDiv = document.createElement('div');
            interimDiv.id = 'interim-speech';
            interimDiv.className = 'interim-speech';
            interimDiv.style.cssText = `
                position: fixed;
                bottom: 80px;
                left: 20px;
                right: 20px;
                background: rgba(0, 255, 0, 0.1);
                border: 1px solid #00ff00;
                padding: 10px;
                border-radius: 5px;
                font-family: monospace;
                color: #00ff00;
                z-index: 1000;
                font-size: 14px;
                backdrop-filter: blur(5px);
            `;
            document.body.appendChild(interimDiv);
        }
        
        interimDiv.innerHTML = `<strong>Слухаю:</strong> ${transcript}`;
        
        // Clear interim display after 2 seconds of no updates
        clearTimeout(this.interimTimeout);
        this.interimTimeout = setTimeout(() => {
            if (interimDiv && interimDiv.parentNode) {
                interimDiv.parentNode.removeChild(interimDiv);
            }
        }, 2000);
    }

    addSpeechControls() {
        // Add speech toggle button
        const speechButton = document.createElement('button');
        speechButton.id = 'speech-toggle';
        speechButton.className = 'speech-control-btn';
        speechButton.innerHTML = '🎤';
        speechButton.title = 'Toggle speech recognition (STT)';
        speechButton.onclick = () => this.toggleSpeechRecognition();
        speechButton.style.cssText = `
            margin-left: 5px;
            padding: 8px 12px;
            background: rgba(0, 255, 0, 0.1);
            border: 1px solid #00ff00;
            border-radius: 4px;
            color: #00ff00;
            cursor: pointer;
            font-size: 16px;
        `;
        
        // Add next to voice controls
        const voiceButton = document.getElementById('voice-toggle');
        if (voiceButton && voiceButton.parentElement) {
            voiceButton.parentElement.appendChild(speechButton);
        } else {
            // If no voice button, add to input container
            const inputContainer = this.chatInput.parentElement;
            if (inputContainer) {
                inputContainer.appendChild(speechButton);
            }
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
        const speechButton = document.getElementById('speech-toggle');
        if (speechButton) {
            if (this.speechSystem.isListening) {
                speechButton.innerHTML = '🔴🎤'; // Red dot indicates active listening
                speechButton.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                speechButton.title = 'Listening... (Click to stop)';
            } else if (this.speechSystem.isEnabled) {
                speechButton.innerHTML = '🟢🎤'; // Green dot indicates ready
                speechButton.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
                speechButton.title = 'Speech recognition enabled (Click to disable)';
            } else {
                speechButton.innerHTML = '🎤';
                speechButton.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
                speechButton.title = 'Speech recognition disabled (Click to enable)';
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