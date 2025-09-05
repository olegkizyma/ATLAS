/**
 * Atlas Chat Manager
 * Управління чатом без блокування інтерфейсу
 */
class AtlasChatManager {
    constructor() {
        this.isStreaming = false;
        this.isStreamPending = false;
    this.messages = [];
    // Separate bases: orchestrator (Node) and frontend (Flask)
    this.orchestratorBase = (window.ATLAS_CFG && window.ATLAS_CFG.orchestratorBase) || window.location.origin;
    this.frontendBase = (window.ATLAS_CFG && window.ATLAS_CFG.frontendBase) || window.location.origin;
        this.retryCount = 0;
        this.maxRetries = 3;
    // Persist one session id for the whole page session
    this.sessionId = `atlas_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.init();
    }
    
    init() {
        this.chatInput = document.getElementById('message-input');
        this.chatButton = document.getElementById('send-button');
        this.chatContainer = document.getElementById('chat-container');
        
        if (!this.chatInput || !this.chatButton || !this.chatContainer) {
            console.warn('Chat elements not found - chat functionality disabled (minimal mode)');
            return;
        }
        
        this.setupEventListeners();
        this.log('Atlas Chat Manager initialized');
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
        if (!message || this.isStreaming) return;
        
        // Check if user wants to talk directly to Tetyana
        const directToTetyana = message.toLowerCase().includes('@тетяна') || 
                              message.toLowerCase().includes('@tetyana') ||
                              message.toLowerCase().startsWith('тетяна,') ||
                              message.toLowerCase().startsWith('tetyana,');
        
        this.lockInput('Надсилаю...');
        this.displayUserMessage(message);
        this.chatInput.value = '';
        
        try {
            let response;
            
            if (directToTetyana) {
                // Direct communication with Tetyana via Goose
                const cleanMessage = message.replace(/@?(тетяна|tetyana),?\s*/gi, '').trim();
                response = await this.sendToTetyana(cleanMessage);
            } else {
                // Multi-agent conversation via orchestrator (non-streaming JSON)
                response = await this.callOrchestrator(message);
            }
            
            if (response && response.success) {
                this.displayAgentResponses(response.response || []);
                this.retryCount = 0;
            } else {
                this.displayError(response?.error || 'Помилка відповіді сервера');
            }
        } catch (error) {
            this.log('Send message error:', error);
            this.handleError(error, message);
        } finally {
            this.unlockInput();
        }
    }
    
    async sendToTetyana(message) {
        this.log(`Sending message directly to Tetyana: ${message.substring(0, 50)}...`);
        
        try {
            // Try orchestrator's direct Tetyana endpoint first
            const response = await fetch(`${this.orchestratorBase}/agent/tetyana`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.generateSessionId()
                })
            });
            
            if (response.ok) {
                return await response.json();
            }
            
            // Fallback to frontend's Tetyana endpoint
            const frontendResponse = await fetch(`${this.frontendBase}/api/agents/tetyana`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    sessionId: this.generateSessionId()
                })
            });
            
            if (frontendResponse.ok) {
                return await frontendResponse.json();
            }
            
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            
        } catch (error) {
            this.log('Tetyana communication error:', error);
            throw error;
        }
    }
    
    generateSessionId() {
        return `atlas_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    async callOrchestrator(message) {
        this.log(`Sending message to orchestrator: ${message.substring(0, 50)}...`);
        
        const response = await fetch(`${this.orchestratorBase}/chat/stream`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                sessionId: this.sessionId,
                userId: 'user'
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.json();
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
        
        try {
            this.isStreaming = true;
            this.log(`Starting Orchestrator stream (attempt ${retryAttempt + 1}/${maxRetries + 1})...`);
            
        const response = await fetch(`${this.orchestratorBase}/chat/stream`, {
                method: 'POST',
                headers: {
            'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    message, 
                    sessionId: this.sessionId || undefined,
                    retryAttempt: retryAttempt
                }),
                signal: controller.signal
            });
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
            }

            // Обробка Server-Sent Events
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }

            const decoder = new TextDecoder();
            let currentAgent = null;
            let currentElement = null;
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
                    if (line.trim() === '') continue;

                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            this.log('Stream completed successfully');
                            clearInterval(activityCheckInterval);
                            return;
                        }

                        try {
                            const parsed = JSON.parse(data);
                            const { type, agent, content } = parsed;
                            if (type === 'start' || type === 'info') {
                                // system/info events -> log panel only
                                this.log(`${agent || 'system'}: ${content || type}`);
                            } else if (type === 'agent_message') {
                                // switch or continue agent stream
                                if (currentAgent !== agent) {
                                    currentAgent = agent;
                                    currentElement = this.addMessage(agentLabel(agent), '');
                                }
                                if (content) {
                                    this.appendToMessage(currentElement, content);
                                }
                            } else if (type === 'error') {
                                this.addMessage('system', `Помилка оркестратора: ${parsed.error}`);
                            } else if (type === 'complete') {
                                this.log('Stream completed successfully');
                                clearInterval(activityCheckInterval);
                                return;
                            }
                        } catch (parseError) {
                            this.log(`Chunk parse error: ${parseError.message}`, 'warning');
                            // Continue processing other chunks
                        }
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
                    this.addMessage('system', `Переривання зв'язку. Повторна спроба через ${retryDelay/1000}с...`);
                    
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
                    this.addMessage('system', `Помилка мережі. Повторна спроба через ${retryDelay/1000}с...`);
                    
                    await this.delay(retryDelay);
                    return await this.streamFromOrchestrator(message, retryAttempt + 1);
                }
            }
            
            // Check for server errors (5xx) that might be temporary
            if (error.message.includes('HTTP 5')) {
                this.log(`Server error: ${error.message} - attempt ${retryAttempt + 1}`);
                
                if (retryAttempt < maxRetries) {
                    const retryDelay = Math.min(baseDelay * Math.pow(2, retryAttempt), maxDelay);
                    this.addMessage('system', `Серверна помилка. Повторна спроба через ${retryDelay/1000}с...`);
                    
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
    
    // Helper method for retry delays
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    addMessage(role, content) {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${role}`;
        messageElement.textContent = content;
        
        this.chatContainer.appendChild(messageElement);
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
        
        return messageElement;
    }
    
    updateMessage(element, content) {
        element.textContent = content;
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
    
    appendToMessage(element, delta) {
        element.textContent += delta;
        this.chatContainer.scrollTop = this.chatContainer.scrollHeight;
    }
    
    setInputState(disabled, placeholder = '') {
        if (this.chatInput) {
            this.chatInput.disabled = disabled;
            if (placeholder) {
                this.chatInput.placeholder = placeholder;
            } else {
                this.chatInput.placeholder = disabled ? 'Обробка...' : 'Напишіть повідомлення...';
            }
        }
        
        if (this.chatButton) {
            this.chatButton.disabled = disabled;
            this.chatButton.textContent = disabled ? '⏳' : '📤';
        }
        
        this.log(`Input ${disabled ? 'locked' : 'unlocked'}`, disabled ? 'warning' : 'info');
    }
    
    checkAndUnlockInput() {
        // Примусове розблокування якщо немає активних стрімів
        if (!this.isStreaming && !this.isStreamPending && this.chatInput && this.chatInput.disabled) {
            this.log('Auto-unlock triggered', 'warning');
            this.setInputState(false);
        }
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`[${timestamp}] [CHAT] ${message}`);
        
        // Відправляємо в логи інтерфейсу
        if (window.atlasLogger) {
            window.atlasLogger.addLog(message, level, 'chat');
        }
    }
}

// Експортуємо для глобального використання
window.AtlasChatManager = AtlasChatManager;

function agentLabel(agent) {
    const a = (agent || '').toLowerCase();
    if (a.includes('grisha')) return 'grisha';
    if (a.includes('tetiana') || a.includes('goose')) return 'tetiana';
    if (a.includes('atlas')) return 'assistant';
    return 'assistant';
}
