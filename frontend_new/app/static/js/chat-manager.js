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
    
    async streamFromOrchestrator(message) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 хв
        
        try {
            this.isStreaming = true;
            this.log('Starting Orchestrator stream...');
            const response = await fetch(`${this.apiBase}/chat/stream`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message, sessionId: this.sessionId || undefined }),
                signal: controller.signal
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            // Обробка Server-Sent Events
            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('No response body reader available');
            }
            
            const decoder = new TextDecoder();
            let currentAgent = null;
            let currentElement = null;
            
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split('\n');
                
                for (const line of lines) {
                    if (line.trim() === '') continue;
                    
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') {
                            this.log('Stream completed successfully');
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
                            }
                        } catch (e) {
                            // Ігноруємо помилки парсингу окремих chunk'ів
                        }
                    }
                }
            }
            
        } finally {
            clearTimeout(timeoutId);
            this.isStreaming = false;
        }
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
