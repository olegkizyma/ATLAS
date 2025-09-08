/**
 * ATLAS Intelligent Chat Application
 * Pure intelligent interface with voice support
 */

class AtlasIntelligentApp {
    constructor() {
        this.isInitialized = false;
        this.sessionId = `atlas_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.isProcessing = false;
        
        // Voice system
        this.voiceEnabled = false;
        this.isListening = false;
        this.recognition = null;
        this.currentAudio = null;
        
        // Stats
        this.stats = {
            requests: 0,
            successful: 0,
            failed: 0,
            startTime: Date.now()
        };
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    
    init() {
        if (this.isInitialized) return;
        
        console.log('🚀 Initializing ATLAS Intelligent App...');
        
        try {
            // Initialize UI elements
            this.initializeElements();
            
            // Setup event listeners
            this.setupEventListeners();
            
            // Initialize voice system
            this.initializeVoiceSystem();
            
            // Start status monitoring
            this.startStatusMonitoring();
            
            this.isInitialized = true;
            console.log('✅ ATLAS App initialized successfully');
            
        } catch (error) {
            console.error('❌ Failed to initialize ATLAS App:', error);
            this.showError('Failed to initialize application');
        }
    }
    
    initializeElements() {
        // Chat elements
        this.chatInput = document.getElementById('chat-input');
        this.sendBtn = document.getElementById('send-btn');
        this.chatMessages = document.getElementById('chat-messages');
        this.typingIndicator = document.getElementById('typing-indicator');
        
        // Control elements
        this.voiceToggle = document.getElementById('voice-toggle');
        this.clearBtn = document.getElementById('clear-chat');
        
        // Status elements
        this.statusIndicator = document.getElementById('status-indicator');
        this.statusDot = this.statusIndicator.querySelector('.status-dot');
        this.statusText = this.statusIndicator.querySelector('.status-text');
        
        // Stats elements
        this.requestsCount = document.getElementById('requests-count');
        this.successRate = document.getElementById('success-rate');
        this.uptime = document.getElementById('uptime');
        
        // Loading overlay
        this.loadingOverlay = document.getElementById('loading-overlay');
        
        if (!this.chatInput || !this.sendBtn || !this.chatMessages) {
            throw new Error('Required elements not found');
        }
    }
    
    setupEventListeners() {
        // Chat input
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });
        
        // Send button
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        // Voice toggle
        if (this.voiceToggle) {
            this.voiceToggle.addEventListener('click', () => this.toggleVoice());
        }
        
        // Clear chat
        if (this.clearBtn) {
            this.clearBtn.addEventListener('click', () => this.clearChat());
        }
        
        // Auto-resize chat input
        this.chatInput.addEventListener('input', () => {
            this.chatInput.style.height = 'auto';
            this.chatInput.style.height = this.chatInput.scrollHeight + 'px';
        });
    }
    
    initializeVoiceSystem() {
        try {
            // Check for Web Speech API support
            if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                this.recognition = new SpeechRecognition();
                
                this.recognition.continuous = false;
                this.recognition.interimResults = false;
                this.recognition.lang = 'uk-UA';
                
                this.recognition.onresult = (event) => {
                    const transcript = event.results[0][0].transcript;
                    this.chatInput.value = transcript;
                    this.setListening(false);
                };
                
                this.recognition.onerror = (event) => {
                    console.error('Speech recognition error:', event.error);
                    this.setListening(false);
                };
                
                this.recognition.onend = () => {
                    this.setListening(false);
                };
                
                this.voiceEnabled = true;
                console.log('✅ Voice recognition initialized');
            } else {
                console.warn('⚠️ Speech recognition not supported');
                if (this.voiceToggle) {
                    this.voiceToggle.style.display = 'none';
                }
            }
        } catch (error) {
            console.error('Voice system initialization failed:', error);
        }
    }
    
    async sendMessage() {
        const message = this.chatInput.value.trim();
        if (!message || this.isProcessing) return;
        
        try {
            this.setProcessing(true);
            this.addMessage(message, 'user');
            this.chatInput.value = '';
            this.chatInput.style.height = 'auto';
            
            this.stats.requests++;
            this.updateStats();
            
            // Send to intelligent backend
            const response = await this.sendToIntelligentBackend(message);
            
            if (response.success && response.response) {
                for (const msg of response.response) {
                    this.addMessage(msg.content, 'agent', msg.agent || 'atlas');
                    
                    // Handle TTS if available
                    if (msg.content && response.tts_ready) {
                        await this.synthesizeSpeech(msg.content, msg.agent || 'atlas');
                    }
                }
                
                this.stats.successful++;
            } else {
                throw new Error(response.error || 'Unknown error');
            }
            
        } catch (error) {
            console.error('Message sending failed:', error);
            this.addMessage(`Помилка: ${error.message}`, 'agent', 'system');
            this.stats.failed++;
        } finally {
            this.setProcessing(false);
            this.updateStats();
        }
    }
    
    async sendToIntelligentBackend(message) {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                sessionId: this.sessionId,
                timestamp: Date.now()
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
    }
    
    addMessage(content, type, agent = 'atlas') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}-message ${agent}`;
        
        const now = new Date();
        const timeStr = now.toLocaleTimeString('uk-UA', { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        let agentName = 'User';
        if (type === 'agent') {
            switch (agent) {
                case 'atlas': agentName = 'ATLAS'; break;
                case 'tetyana': agentName = 'ТЕТЯНА'; break;
                case 'grisha': agentName = 'ГРИША'; break;
                default: agentName = agent.toUpperCase();
            }
        }
        
        messageDiv.innerHTML = `
            <div class="message-header">
                <span class="agent-name ${agent}">${agentName}</span>
                <span class="message-time">${timeStr}</span>
            </div>
            <div class="message-content">${this.formatMessage(content)}</div>
        `;
        
        this.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();
    }
    
    formatMessage(content) {
        // Basic text formatting
        return content
            .replace(/\n/g, '<br>')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>');
    }
    
    scrollToBottom() {
        this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
    
    setProcessing(processing) {
        this.isProcessing = processing;
        this.sendBtn.disabled = processing;
        this.chatInput.disabled = processing;
        
        if (processing) {
            this.typingIndicator.textContent = 'ATLAS is thinking...';
            this.loadingOverlay.classList.add('show');
        } else {
            this.typingIndicator.textContent = '';
            this.loadingOverlay.classList.remove('show');
        }
    }
    
    toggleVoice() {
        if (!this.voiceEnabled || !this.recognition) return;
        
        if (this.isListening) {
            this.recognition.stop();
            this.setListening(false);
        } else {
            try {
                this.recognition.start();
                this.setListening(true);
            } catch (error) {
                console.error('Failed to start recognition:', error);
            }
        }
    }
    
    setListening(listening) {
        this.isListening = listening;
        if (this.voiceToggle) {
            this.voiceToggle.classList.toggle('active', listening);
            this.voiceToggle.title = listening ? 'Stop Listening' : 'Start Voice Input';
        }
        
        if (listening) {
            this.typingIndicator.textContent = 'Listening...';
        } else if (!this.isProcessing) {
            this.typingIndicator.textContent = '';
        }
    }
    
    async synthesizeSpeech(text, agent = 'atlas') {
        try {
            // Stop current audio if playing
            if (this.currentAudio) {
                this.currentAudio.pause();
                this.currentAudio = null;
            }
            
            // Prepare text for TTS
            const prepareResponse = await fetch('/api/voice/prepare_response', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ text: text })
            });
            
            if (!prepareResponse.ok) return;
            
            const prepareData = await prepareResponse.json();
            if (!prepareData.success || !prepareData.text.trim()) return;
            
            // Synthesize speech
            const ttsResponse = await fetch('/api/voice/synthesize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    text: prepareData.text,
                    agent: prepareData.agent,
                    voice: prepareData.voice
                })
            });
            
            if (ttsResponse.ok) {
                const audioBlob = await ttsResponse.blob();
                const audioUrl = URL.createObjectURL(audioBlob);
                
                this.currentAudio = new Audio(audioUrl);
                
                this.currentAudio.onended = () => {
                    URL.revokeObjectURL(audioUrl);
                    this.currentAudio = null;
                };
                
                this.currentAudio.onerror = (error) => {
                    console.error('Audio playback error:', error);
                    URL.revokeObjectURL(audioUrl);
                    this.currentAudio = null;
                };
                
                await this.currentAudio.play();
            }
            
        } catch (error) {
            console.error('TTS synthesis failed:', error);
        }
    }
    
    clearChat() {
        const welcomeMessage = this.chatMessages.querySelector('.welcome-message');
        this.chatMessages.innerHTML = '';
        if (welcomeMessage) {
            this.chatMessages.appendChild(welcomeMessage);
        }
    }
    
    startStatusMonitoring() {
        this.checkSystemStatus();
        setInterval(() => this.checkSystemStatus(), 30000); // Every 30 seconds
        
        // Update uptime every second
        setInterval(() => this.updateUptime(), 1000);
    }
    
    async checkSystemStatus() {
        try {
            const response = await fetch('/api/health');
            const data = await response.json();
            
            if (data.status === 'ok' && data.engine_initialized) {
                this.setStatus('online', 'System Online');
            } else {
                this.setStatus('warning', 'Initializing...');
            }
            
        } catch (error) {
            this.setStatus('offline', 'System Offline');
        }
    }
    
    setStatus(status, text) {
        this.statusDot.className = `status-dot ${status}`;
        this.statusText.textContent = text;
    }
    
    updateStats() {
        if (this.requestsCount) {
            this.requestsCount.textContent = this.stats.requests;
        }
        
        if (this.successRate && this.stats.requests > 0) {
            const rate = Math.round((this.stats.successful / this.stats.requests) * 100);
            this.successRate.textContent = `${rate}%`;
        }
    }
    
    updateUptime() {
        if (this.uptime) {
            const uptimeSeconds = Math.floor((Date.now() - this.stats.startTime) / 1000);
            
            if (uptimeSeconds < 60) {
                this.uptime.textContent = `${uptimeSeconds}s`;
            } else if (uptimeSeconds < 3600) {
                this.uptime.textContent = `${Math.floor(uptimeSeconds / 60)}m`;
            } else {
                const hours = Math.floor(uptimeSeconds / 3600);
                const minutes = Math.floor((uptimeSeconds % 3600) / 60);
                this.uptime.textContent = `${hours}h ${minutes}m`;
            }
        }
    }
    
    showError(message) {
        this.addMessage(`Системна помилка: ${message}`, 'agent', 'system');
    }
}

// Initialize the app
window.atlasApp = new AtlasIntelligentApp();