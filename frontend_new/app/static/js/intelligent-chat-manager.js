/**
 * Atlas Intelligent Voice-Enhanced Chat Manager
 * Розумне управління чатом з підтримкою голосових агентів
 */
class AtlasIntelligentChatManager {
    constructor() {
        this.isStreaming = false;
        this.isStreamPending = false;
        this.messages = [];
        this.apiBase = (window.ATLAS_CFG && window.ATLAS_CFG.orchestratorBase) || window.location.origin;
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
            maxRetries: 2
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
        await this.initVoiceSystem();
        this.log('[CHAT] Intelligent Atlas Chat Manager with Voice System initialized');
    }
    
    async initVoiceSystem() {
        try {
            // Перевіряємо доступність voice API
            const response = await fetch(`${this.apiBase}/api/voice/health`);
            if (response.ok) {
                const data = await response.json();
                this.voiceSystem.enabled = data.success;
                this.log(`[VOICE] Voice system ${this.voiceSystem.enabled ? 'enabled' : 'disabled'}`);
                
                if (this.voiceSystem.enabled) {
                    // Завантажуємо інформацію про агентів
                    await this.loadAgentInfo();
                    this.addVoiceControls();
                }
            }
        } catch (error) {
            this.log(`[VOICE] Voice system unavailable: ${error.message}`);
            this.voiceSystem.enabled = false;
        }
    }
    
    async loadAgentInfo() {
        try {
            const response = await fetch(`${this.apiBase}/api/voice/agents`);
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
        const timeoutDuration = Math.min(60000 + (retryAttempt * 30000), 240000); // Progressive timeout: 1min -> 4min
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            this.log(`Request timeout after ${timeoutDuration/1000}s (attempt ${retryAttempt + 1})`);
            controller.abort();
        }, timeoutDuration);
        
        this.isStreaming = true;
        
        try {
            this.log(`Starting Orchestrator stream (attempt ${retryAttempt + 1}/${maxRetries + 1})...`);
            
            const response = await fetch(`${this.apiBase}/chat/stream`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive'
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
                            return;
                        }
                        
                        if (type === 'agent_message') {
                            const role = agentLabel(agent);
                            const cls = role === 'assistant' ? 'assistant' : role;
                            
                            if (currentAgent !== cls) {
                                currentAgent = cls;
                                this.addMessage('', cls);
                                const lastMsg = this.chatContainer.lastElementChild;
                                currentTextNode = lastMsg ? lastMsg.querySelector('.message-text') : null;
                            }
                            
                            if (content) {
                                if (currentTextNode) {
                                    this.appendToMessage(currentTextNode, content);
                                    
                                    // Process voice response if enabled
                                    if (this.voiceSystem.enabled && agent) {
                                        await this.processAgentVoice(content, agent).catch(e => 
                                            this.log(`Voice synthesis error: ${e.message}`)
                                        );
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
            const prepareResponse = await fetch(`${this.apiBase}/api/voice/prepare_response`, {
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
                    // Відображаємо повідомлення з підписом агента
                    this.addVoiceMessage(
                        prepData.display_text,
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
            // Stop any current audio playback
            if (this.voiceSystem.currentAudio) {
                this.voiceSystem.currentAudio.pause();
                this.voiceSystem.currentAudio = null;
            }
            
            const agentConfig = this.voiceSystem.agents[agent] || this.voiceSystem.agents.atlas;
            
            // Short text fragments don't need voice synthesis
            if (text.length < 10) {
                return;
            }
            
            // Synthesize voice with agent-specific settings
            await this.synthesizeAndPlay(text, agent);
            
        } catch (error) {
            this.log(`[VOICE] Agent voice processing error: ${error.message}`);
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
            const response = await fetch(`${this.apiBase}/api/voice/synthesize`, {
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
                    
                    const fallbackResponse = await fetch(`${this.apiBase}/api/voice/synthesize`, {
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
            await this.playAudioBlob(audioBlob, `${agent} (${voice})`);
            
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
    
    async playAudioBlob(audioBlob, description) {
        return new Promise((resolve, reject) => {
            try {
                const audioUrl = URL.createObjectURL(audioBlob);
                const audio = new Audio(audioUrl);
                this.voiceSystem.currentAudio = audio;
                
                audio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    this.voiceSystem.currentAudio = null;
                    resolve();
                };
                
                audio.onerror = (error) => {
                    this.log(`[VOICE] Audio playback error: ${error}`);
                    URL.revokeObjectURL(audioUrl);
                    this.voiceSystem.currentAudio = null;
                    reject(error);
                };
                
                audio.play().then(() => {
                    this.log(`[VOICE] Playing ${description}`);
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
        
        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.innerHTML = this.formatMessage(text);
        textDiv.style.borderLeft = `3px solid ${color}`;
        
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
        // Форматування тексту з підтримкою підписів агентів
        return text
            .replace(/\[ATLAS\]/g, '<span class="agent-signature atlas">[ATLAS]</span>')
            .replace(/\[ТЕТЯНА\]/g, '<span class="agent-signature tetyana">[ТЕТЯНА]</span>')
            .replace(/\[ГРИША\]/g, '<span class="agent-signature grisha">[ГРИША]</span>')
            .replace(/\n/g, '<br>');
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