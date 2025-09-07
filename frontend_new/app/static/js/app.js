/**
 * Atlas Application Controller
 * Головний контролер додатку без перезавантажень
 */

// Check if we're in development mode (cache busting enabled)
const isDevelopment = window.location.search.includes('v=') || 
                     document.querySelector('script[src*="?v="]') !== null;

if (isDevelopment) {
    console.log('🔧 ATLAS DEVELOPMENT MODE: Cache disabled for fresh updates');
    console.log('🔄 Static files will reload on every request');
}

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
            
            // Робимо logger глобально доступним відразу
            window.atlasLogger = this.managers.logger;
            
            // Ініціалізуємо status manager
            this.managers.status = new AtlasStatusManager();
            window.atlasStatus = this.managers.status;
            
            // Використовуємо інтелектуальний чат-менеджер з голосовою системою
            // Конструктор сам викликає initVoiceSystem(); додатковий виклик прибрано, щоб уникнути дублю
            this.managers.chat = new AtlasIntelligentChatManager();
            // Inject phase badge CSS once
            if (!document.getElementById('phase-badge-style')) {
                const st = document.createElement('style');
                st.id = 'phase-badge-style';
                st.textContent = `.phase-badge{font-family:system-ui,monospace;user-select:none;}`;
                document.head.appendChild(st);
            }
            
            // Ініціалізуємо мінімалістичний чат
            this.initMinimalChat();
            
            // Ініціалізуємо vision систему якщо доступна
            if (window.AtlasVision) {
                this.managers.vision = new window.AtlasVision();
                window.atlasVision = this.managers.vision;
                this.log('Atlas Vision system initialized');
            }
            
            // Робимо інші менеджери глобально доступними
            window.atlasChat = this.managers.chat;
            // atlasStatus вже встановлений вище, якщо існує
            
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
        const chatContent = document.getElementById('chat-content');
        
        if (chatContent) {
            // Чат завжди видимий
            chatContent.style.display = 'block';
            
            this.log('Minimal chat initialized');

            // Табы Chat/Logs
            const tabChat = document.getElementById('tab-chat');
            const tabLogs = document.getElementById('tab-logs');
            const chatView = document.getElementById('chat-view');
            const logsView = document.getElementById('logs-view');
            if (tabChat && tabLogs && chatView && logsView) {
                const activate = (name) => {
                    if (name === 'chat') {
                        tabChat.classList.add('active');
                        tabLogs.classList.remove('active');
                        chatView.style.display = 'flex';
                        chatView.classList.add('active');
                        logsView.style.display = 'none';
                        logsView.classList.remove('active');
                    } else {
                        tabLogs.classList.add('active');
                        tabChat.classList.remove('active');
                        logsView.style.display = 'flex';
                        logsView.classList.add('active');
                        chatView.style.display = 'none';
                        chatView.classList.remove('active');
                    }
                };
                tabChat.onclick = () => activate('chat');
                tabLogs.onclick = () => {
                    activate('logs');
                    // Форсируем обновление логов при открытии вкладки
                    try { this.managers.logger && this.managers.logger.refreshLogs(); } catch (_) {}
                };
            }
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
