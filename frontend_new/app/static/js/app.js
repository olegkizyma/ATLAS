/**
 * Atlas Application Controller
 * Головний контролер додатку без перезавантажень
 */
class AtlasApp {
    constructor() {
        this.managers = {};
        this.isInitialized = false;
        this.pageLoadId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        
        // Захист від перезавантажень
        this.setupReloadProtection();
        
        // Ініціалізуємо коли DOM готовий
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }
    
    init() {
        if (this.isInitialized) return;
        
        console.log('🚀 ATLAS APP INIT:', this.pageLoadId, 'at', new Date().toTimeString());
        
        try {
            // Ініціалізуємо менеджери в правильному порядку
            this.managers.logger = new AtlasLogger();
            this.managers.status = new AtlasStatusManager();
            
            // Використовуємо інтелектуальний чат-менеджер з голосовою системою
            this.managers.chat = new AtlasIntelligentChatManager();
            
            // Ініціалізуємо голосову систему
            this.managers.chat.initVoiceSystem().catch(e => 
                console.warn('Voice system init failed:', e.message)
            );
            
            // Ініціалізуємо мінімалістичний чат
            this.initMinimalChat();
            
            // Робимо глобально доступними
            window.atlasLogger = this.managers.logger;
            window.atlasChat = this.managers.chat;
            window.atlasStatus = this.managers.status;
            
            this.isInitialized = true;
            this.log('Atlas Intelligent Application initialized successfully');
            
            // Гарантуємо що input розблокований при старті
            setTimeout(() => {
                if (this.managers.chat) {
                    this.managers.chat.setInputState(true);
                }
            }, 1000);
            
        } catch (error) {
            console.error('Atlas initialization error:', error);
            this.showErrorMessage(`Initialization failed: ${error.message}`);
        }
    }
    
    initMinimalChat() {
        // Ініціалізуємо мінімалістичний чат
        const chatToggle = document.getElementById('chat-toggle');
        const chatContent = document.getElementById('chat-content');
        
        if (chatToggle && chatContent) {
            chatToggle.addEventListener('click', () => {
                const isVisible = chatContent.style.display !== 'none';
                chatContent.style.display = isVisible ? 'none' : 'block';
                chatToggle.textContent = isVisible ? '💬 Chat' : '❌ Close';
            });
            
            this.log('Minimal chat initialized');
        }
    }
    
    setupReloadProtection() {
        // Захист від занадто частих перезавантажень
        const lastReload = sessionStorage.getItem('atlasLastReload');
        const currentTime = Date.now();
        
        if (lastReload && (currentTime - parseInt(lastReload)) < 3000) {
            console.warn('🛑 SUSPECTED RELOAD LOOP - Adding protection');
            // Затримка для перерви можливого циклу перезавантажень
            setTimeout(() => {
                console.log('🔓 Reload protection finished');
            }, 2000);
        }
        
        sessionStorage.setItem('atlasLastReload', currentTime.toString());
        
        // Захист від випадкових перезавантажень
        window.addEventListener('beforeunload', (e) => {
            console.log('⚠️ ATLAS BEFOREUNLOAD:', this.pageLoadId, 'at', new Date().toTimeString());
            
            const isStreaming = this.managers.chat && 
                (this.managers.chat.isStreaming || this.managers.chat.isStreamPending);
            
            // Захищаємо від перезавантажень протягом перших 10 секунд
            const pageAge = Date.now() - parseInt(this.pageLoadId.split('_')[0]);
            const isRecentLoad = pageAge < 10000;
            
            if (isStreaming || isRecentLoad) {
                console.log(`❌ PREVENTING RELOAD: streaming=${isStreaming}, recentLoad=${isRecentLoad}, pageAge=${pageAge}ms`);
                
                let message = 'Зачекайте кілька секунд...';
                if (isStreaming) {
                    message = 'Стрім ще триває. Ви дійсно хочете перезавантажити сторінку?';
                }
                
                e.preventDefault();
                e.returnValue = message;
                return message;
            } else {
                console.log('✅ RELOAD ALLOWED (no active stream, page age: ' + pageAge + 'ms)');
            }
        });
        
        // Глобальний обробник помилок
        window.addEventListener('error', (e) => {
            console.error('Global error:', e.error);
            this.log(`Global error: ${e.error?.message || 'Unknown error'}`, 'error');
        });
        
        window.addEventListener('unhandledrejection', (e) => {
            console.error('Unhandled promise rejection:', e.reason);
            this.log(`Promise rejection: ${e.reason?.message || 'Unknown'}`, 'error');
        });
    }
    
    showErrorMessage(message) {
        // Показуємо помилку в чаті або логах
        if (this.managers.logger) {
            this.managers.logger.addLog(message, 'error', 'app');
        } else {
            console.error(message);
        }
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`[${timestamp}] [APP] ${message}`);
        
        if (this.managers.logger) {
            this.managers.logger.addLog(message, level, 'app');
        }
    }
    
    // Публічні методи для взаємодії
    sendMessage(message) {
        if (this.managers.chat) {
            this.managers.chat.chatInput.value = message;
            this.managers.chat.sendMessage();
        }
    }
    
    getStatus() {
        return {
            initialized: this.isInitialized,
            pageLoadId: this.pageLoadId,
            managers: Object.keys(this.managers),
            chatReady: !!this.managers.chat,
            isStreaming: this.managers.chat ? this.managers.chat.isStreaming : false
        };
    }
}

// Ініціалізуємо додаток
const atlasApp = new AtlasApp();

// Робимо глобально доступним
window.atlasApp = atlasApp;
