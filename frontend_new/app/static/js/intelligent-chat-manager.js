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
    this.orchestratorBase = (window.ATLAS_CFG && window.ATLAS_CFG.orchestratorBase) || window.location.origin;
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
                    voice: 'oleksa',
                    pitch: 1.1, 
                    rate: 0.9,
                    priority: 2
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
            fallbackVoices: ['dmytro', 'oleksa', 'robot'], // Fallback voice list
            maxRetries: 2,
            // TTS synchronization system
            agentMessages: new Map(), // Store accumulated messages per agent  
            ttsQueue: [], // Queue for TTS processing
            isProcessingTTS: false, // Flag to prevent parallel TTS processing
            lastAgentComplete: null // Track when agent finishes speaking
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
        this.log('[CHAT] Intelligent Atlas Chat Manager with Voice System initialized');
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
        const baseDelay = 1000; // 1 second base delay
        const maxDelay = 10000; // 10 seconds max delay
    const timeoutDuration = Math.min(120000 + (retryAttempt * 60000), 420000); // Progressive timeout: 2min -> 7min
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            this.log(`Request timeout after ${timeoutDuration/1000}s (attempt ${retryAttempt + 1})`);
            controller.abort();
        }, timeoutDuration);
        
        this.isStreaming = true;
        
        try {
            this.log(`Starting Orchestrator stream (attempt ${retryAttempt + 1}/${maxRetries + 1})...`);
            
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
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }
            
            const reader = response.body?.getReader();
            if (!reader) throw new Error('No response body reader available');
            
            const decoder = new TextDecoder();
            let currentAgent = null;
            let currentTextNode = null;
            let lastActivity = Date.now();
            
            // Monitor for stream inactivity
            const activityCheckInterval = setInterval(() => {
                if (Date.now() - lastActivity > 30000) { // 30s inactivity
                    this.log('Stream inactive for 30s, checking connection...');
                    clearInterval(activityCheckInterval);
                }
            }, 10000);
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    clearInterval(activityCheckInterval);
                    break;
                }
                
                lastActivity = Date.now();
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (!line || line.trim() === '') continue;
                    if (!line.startsWith('data: ')) continue;
                    const data = line.slice(6);
                    if (data === '[DONE]') { 
                        this.log('Stream completed successfully'); 
                        clearInterval(activityCheckInterval);
                        
                        // Finalize last agent message for TTS
                        if (currentAgent && this.voiceSystem.enabled) {
                            await this.finalizeAgentMessage(currentAgent);
                        }
                        
                        return;
                    }
                    
                    try {
                        const evt = JSON.parse(data);
                        const { type, agent, content, error } = evt;
                        
                        if (type === 'start' || type === 'info') {
                            this.log(`${agent || 'system'}: ${content || type}`);
                            continue;
                        }
                        
                        if (type === 'error') {
                            this.addMessage(`Помилка оркестратора: ${error || evt.error || 'невідома'}`, 'error');
                            continue;
                        }
                        
                        if (type === 'complete') {
                            this.log('Orchestrator signaled completion');
                            clearInterval(activityCheckInterval);
                            
                            // Finalize last agent message for TTS
                            if (currentAgent && this.voiceSystem.enabled) {
                                await this.finalizeAgentMessage(currentAgent);
                            }
                            
                            return;
                        }
                        
                        if (type === 'agent_message') {
                            const role = agentLabel(agent);
                            const cls = role === 'assistant' ? 'assistant' : role;
                            
                            if (currentAgent !== cls) {
                                // Previous agent finished - process accumulated message for TTS
                                if (currentAgent && this.voiceSystem.enabled) {
                                    await this.finalizeAgentMessage(currentAgent);
                                }
                                
                                currentAgent = cls;
                                this.addMessage('', cls);
                                const lastMsg = this.chatContainer.lastElementChild;
                                currentTextNode = lastMsg ? lastMsg.querySelector('.message-text') : null;
                                
                                // Додаємо лейбл спікера (для асистента) при старті нової бульбашки
                                if (lastMsg && cls === 'assistant') {
                                    const canonical = this.getCanonicalAgentName(agent);
                                    const agentCfg = this.voiceSystem.agents[canonical] || {};
                                    const displaySignature = agentCfg.signature || `[${canonical.toUpperCase()}]`;
                                    const color = agentCfg.color || '#00ff00';
                                    if (!lastMsg.querySelector('.agent-label')) {
                                        const labelDiv = document.createElement('div');
                                        labelDiv.className = 'agent-label';
                                        labelDiv.textContent = displaySignature;
                                        labelDiv.style.fontWeight = '600';
                                        labelDiv.style.fontFamily = 'monospace';
                                        labelDiv.style.color = color;
                                        labelDiv.style.marginBottom = '4px';
                                        lastMsg.insertBefore(labelDiv, currentTextNode || lastMsg.firstChild);
                                    }
                                }
                                
                                // Initialize message accumulation for new agent
                                if (this.voiceSystem.enabled && agent) {
                                    const canonical = this.getCanonicalAgentName(agent);
                                    this.voiceSystem.agentMessages.set(canonical, '');
                                }
                            }
                            
                            if (content) {
                                if (currentTextNode) {
                                    this.appendToMessage(currentTextNode, content);
                                    
                                    // Accumulate content for TTS (don't synthesize yet)
                                    if (this.voiceSystem.enabled && agent) {
                                        const canonical = this.getCanonicalAgentName(agent);
                                        const existing = this.voiceSystem.agentMessages.get(canonical) || '';
                                        this.voiceSystem.agentMessages.set(canonical, existing + content);
                                    }
                                } else {
                                    this.addMessage(content, cls);
                                }
                            }
                        }
                    } catch (parseError) {
                        this.log(`Chunk parse error: ${parseError.message}`, 'warning');
                        // Continue processing other chunks
                    }
                }
            }
            
            clearInterval(activityCheckInterval);
            
            // Finalize last agent message for TTS
            if (currentAgent && this.voiceSystem.enabled) {
                await this.finalizeAgentMessage(currentAgent);
            }
            
        } catch (error) {
            clearTimeout(timeoutId);
            this.isStreaming = false;
            
            // Check if this is an abort error
            if (error.name === 'AbortError') {
                this.log(`Request aborted (timeout or manual cancel) - attempt ${retryAttempt + 1}`);
                
                if (retryAttempt < maxRetries) {
                    const retryDelay = Math.min(baseDelay * Math.pow(2, retryAttempt), maxDelay);
                    this.addMessage(`Переривання зв'язку. Повторна спроба через ${retryDelay/1000}с...`, 'warning');
                    
                    await this.delay(retryDelay);
                    return await this.streamFromOrchestrator(message, retryAttempt + 1);
                } else {
                    throw new Error(`Перевищено максимальну кількість спроб (${maxRetries + 1}). Перевірте з'єднання з інтернетом.`);
                }
            }
            
            // Check for network errors
            if (error.message.includes('fetch') || error.message.includes('network') || error.message.includes('ERR_')) {
                this.log(`Network error: ${error.message} - attempt ${retryAttempt + 1}`);
                
                if (retryAttempt < maxRetries) {
                    const retryDelay = Math.min(baseDelay * Math.pow(2, retryAttempt), maxDelay);
                    this.addMessage(`Помилка мережі. Повторна спроба через ${retryDelay/1000}с...`, 'warning');
                    
                    await this.delay(retryDelay);
                    return await this.streamFromOrchestrator(message, retryAttempt + 1);
                }
            }
            
            // Check for server errors (5xx) that might be temporary
            if (error.message.includes('HTTP 5')) {
                this.log(`Server error: ${error.message} - attempt ${retryAttempt + 1}`);
                
                if (retryAttempt < maxRetries) {
                    const retryDelay = Math.min(baseDelay * Math.pow(2, retryAttempt), maxDelay);
                    this.addMessage(`Серверна помилка. Повторна спроба через ${retryDelay/1000}с...`, 'warning');
                    
                    await this.delay(retryDelay);
                    return await this.streamFromOrchestrator(message, retryAttempt + 1);
                }
            }
            
            // If we get here, either it's a non-retryable error or we've exhausted retries
            throw error;
            
        } finally {
            clearTimeout(timeoutId);
            this.isStreaming = false;
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
                        await this.synthesizeAndPlay(prepData.text, prepData.agent);
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

        // Find the actual agent name from currentAgent class
        let agentName = null;
        for (const [name, config] of Object.entries(this.voiceSystem.agents)) {
            if (currentAgent.includes(name) || currentAgent === 'assistant' && name === 'atlas') {
                agentName = name;
                break;
            }
        }

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

            // Synthesize full message
            await this.synthesizeAndPlay(fullMessage, agentName);

            // Clear the accumulated message
            this.voiceSystem.agentMessages.delete(agentName);

        } catch (error) {
            this.log(`[VOICE] Failed to finalize agent message: ${error.message}`);
            this.voiceSystem.agentMessages.delete(agentName);
        }
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
            
            this.log(`[VOICE] Synthesizing ${agent} voice with ${voice} (attempt ${retryCount + 1})`);
            
            // Синтезуємо голос з налаштуваннями агента
            const response = await fetch(`${this.frontendBase}/api/voice/synthesize`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: text,
                    agent: agent,
                    voice: voice,
                    pitch: agentConfig.pitch || 1.0,
                    rate: agentConfig.rate || 1.0
                }),
                timeout: 15000 // 15 second timeout for TTS
            });
            
            if (!response.ok) {
                // If specific voice fails, try fallback
                if (retryCount < this.voiceSystem.maxRetries) {
                    const fallbackVoice = this.voiceSystem.fallbackVoices[retryCount % this.voiceSystem.fallbackVoices.length];
                    this.log(`[VOICE] Voice synthesis failed, trying fallback: ${fallbackVoice}`);
                    
                    const fallbackResponse = await fetch(`${this.frontendBase}/api/voice/synthesize`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            text: text,
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
            await this.playAudioBlob(audioBlob, `${agent} (${voice})`, { agent, text });
            
        } catch (error) {
            if (retryCount < this.voiceSystem.maxRetries) {
                this.log(`[VOICE] Synthesis error, retrying: ${error.message}`);
                await this.delay(1000 * (retryCount + 1)); // Progressive delay
                return await this.synthesizeAndPlay(text, agent, retryCount + 1);
            } else {
                this.log(`[VOICE] Voice synthesis failed after retries: ${error.message}`);
                // Try browser's built-in speech synthesis as last resort
                await this.fallbackToWebSpeech(text, agent);
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
}

// Ініціалізуємо глобальний менеджер чату
window.AtlasChatManager = AtlasIntelligentChatManager;

// helper maps agent name to UI role label
function agentLabel(agent) {
    const a = (agent || '').toLowerCase();
    if (a.includes('grisha')) return 'grisha';
    if (a.includes('tetiana') || a.includes('goose')) return 'tetiana';
    if (a.includes('atlas')) return 'assistant';
    return 'assistant';
}

// Canonicalize agent names from SSE events to voice system keys
AtlasIntelligentChatManager.prototype.getCanonicalAgentName = function(agent) {
    const a = String(agent || '').toLowerCase();
    if (a.includes('grisha')) return 'grisha';
    if (a.includes('tetiana') || a.includes('goose')) return 'tetyana';
    // default assistant/atlas
    return 'atlas';
};