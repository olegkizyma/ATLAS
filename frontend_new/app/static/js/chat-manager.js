/**
 * Atlas Chat Manager
 * Управління чатом без блокування інтерфейсу
 */
class AtlasChatManager {
    constructor() {
        this.isStreaming = false;
        this.isStreamPending = false;
        this.messages = [];
    this.apiBase = (window.ATLAS_CFG && window.ATLAS_CFG.orchestratorBase) || window.location.origin;
        this.retryCount = 0;
        this.maxRetries = 3;
        
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
        if (!message) return;
        
        if (this.isStreaming || this.isStreamPending) {
            this.log('Message blocked: stream in progress', 'warning');
            return;
        }
        
        try {
            // Блокуємо інтерфейс
            this.setInputState(true, 'Надсилання...');
            this.isStreamPending = true;
            
            // Додаємо повідомлення користувача
            this.addMessage('user', message);
            this.chatInput.value = '';
            
            // Стрім безпосередньо до Node-оркестратора
            await this.streamFromOrchestrator(message);
            
        } catch (error) {
            this.log(`Send error: ${error.message}`, 'error');
            this.addMessage('system', `Помилка: ${error.message}`);
        } finally {
            // ГАРАНТОВАНЕ РОЗБЛОКУВАННЯ
            this.setInputState(false);
            this.isStreaming = false;
            this.isStreamPending = false;
            
            // Додатковий захист через 100мс
            setTimeout(() => {
                this.setInputState(false);
            }, 100);
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
        
        try {
            this.isStreaming = true;
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
