/**
 * Atlas Status Manager
 * Відстеження статусу системи без перевантажень
 */
class AtlasStatusManager {
    constructor() {
        this.apiBase = window.location.origin;
    this.refreshInterval = 8000; // 8 секунд замість 5 - менше навантаження
        this.lastRefresh = 0;
        
        this.init();
    }
    
    init() {
    // Точки-індикатори біля бейджа ATLAS
    this.bindDots();
        
        // Кліки по точках показують підказки
    this.attachDotListeners();

        this.startStatusMonitoring();
        this.log('Atlas Status Manager initialized');
    }
    
    startStatusMonitoring() {
        // Початкове оновлення
        this.updateStatus();
        
        // Періодичне оновлення
        setInterval(() => {
            this.updateStatus();
        }, this.refreshInterval);
    }
    
    async updateStatus() {
        const now = Date.now();
        if (now - this.lastRefresh < this.refreshInterval - 1000) {
            return; // Запобігаємо занадто частим запитам
        }
        
        this.lastRefresh = now;
        
        try {
            // Якщо точки ще не ініціалізовані (створюються пізніше праворуч) — пробуємо прив'язатися знову
            if (!this.dotFrontend || !this.dotOrchestrator || !this.dotRecovery || !this.dotTts) {
                this.bindDots();
                this.attachDotListeners();
            }
            
            // Додаємо timeout для запитів
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 секунд timeout
            
            const response = await fetch(`${this.apiBase}/api/status`, {
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) return;
            
            const status = await response.json();
            this.renderDots(status);
            
        } catch (error) {
            // Тихо обробляємо помилки та показуємо невизначений статус
            this.renderDots(null);
            // console.warn('[STATUS] Skipping status update:', error.name);
        }
    }

    renderDots(status) {
        const setDot = (el, state, tooltip) => {
            if (!el) return;
            el.classList.remove('online', 'offline', 'warning');
            el.classList.add(state);
            if (tooltip) {
                el.setAttribute('data-tooltip', tooltip);
                el.setAttribute('title', tooltip);
            }
        };

        if (!status || !status.processes) {
            setDot(this.dotFrontend, 'warning', 'Frontend: unknown');
            setDot(this.dotOrchestrator, 'warning', 'Orchestrator: unknown');
            setDot(this.dotRecovery, 'warning', 'Recovery: unknown');
            setDot(this.dotTts, 'warning', 'TTS: unknown');
            return;
        }

        const p = status.processes;
        const mapState = (val) => {
            if (!val) return 'warning';
            const s = typeof val === 'string' ? val : val.status;
            if (s === 'running' || s === 'online' || (val.count && val.count > 0)) return 'online';
            if (s === 'error' || s === 'stopped' || s === 'offline') return 'offline';
            return 'warning';
        };

        setDot(this.dotFrontend, mapState(p.frontend), `Frontend: ${p.frontend?.status || 'unknown'}`);
        setDot(this.dotOrchestrator, mapState(p.orchestrator), `Orchestrator: ${p.orchestrator?.status || 'unknown'}`);
        setDot(this.dotRecovery, mapState(p.recovery), `Recovery: ${p.recovery?.status || 'unknown'}`);
        setDot(this.dotTts, mapState(p.tts), `TTS: ${p.tts?.status || 'unknown'}`);
    }

    bindDots() {
        this.dotFrontend = document.getElementById('dot-frontend');
        this.dotOrchestrator = document.getElementById('dot-orchestrator');
        this.dotRecovery = document.getElementById('dot-recovery');
        this.dotTts = document.getElementById('dot-tts');
    }

    attachDotListeners() {
        [
            [this.dotFrontend, 'Frontend'],
            [this.dotOrchestrator, 'Orchestrator'],
            [this.dotRecovery, 'Recovery'],
            [this.dotTts, 'TTS']
        ].forEach(([el, name]) => {
            if (!el || el._hasListener) return;
            el.addEventListener('click', () => {
                const tip = el.getAttribute('data-tooltip') || `${name}`;
                this.showTooltip(el, tip);
            });
            el._hasListener = true;
        });
    }

    showTooltip(el, text) {
        if (!el) return;
        let tipEl = el.querySelector('.dot-tooltip');
        if (!tipEl) {
            tipEl = document.createElement('div');
            tipEl.className = 'dot-tooltip';
            Object.assign(tipEl.style, {
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                top: '18px',
                background: 'rgba(0,0,0,0.85)',
                color: '#9cffc7',
                border: '1px solid rgba(0,255,127,0.3)',
                padding: '3px 6px',
                fontSize: '10px',
                borderRadius: '4px',
                whiteSpace: 'nowrap',
                zIndex: '1200'
            });
            el.appendChild(tipEl);
        }
        tipEl.textContent = text;
        tipEl.style.opacity = '1';
        clearTimeout(el._tipTimer);
        el._tipTimer = setTimeout(() => {
            tipEl.style.opacity = '0';
        }, 1500);
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`[${timestamp}] [STATUS] ${message}`);
        
        if (window.atlasLogger) {
            window.atlasLogger.addLog(message, level, 'status');
        }
    }
}

// Експортуємо для глобального використання
window.AtlasStatusManager = AtlasStatusManager;
