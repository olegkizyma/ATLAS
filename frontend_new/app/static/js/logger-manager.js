/**
 * Atlas Logger Manager
 * Управління логами без спаму і зайвих запитів
 */
class AtlasLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.apiBase = window.location.origin;
        this.refreshInterval = 3000; // 3 секунди замість 2
        this.lastRefresh = 0;
        
        this.init();
    }
    
    init() {
        this.logsContainer = document.getElementById('logsContainer');
        
        if (!this.logsContainer) {
            console.error('Logs container not found');
            return;
        }
        
        this.startLogStream();
        this.log('Atlas Logger initialized');
    }
    
    startLogStream() {
        // Початкове завантаження логів
        this.refreshLogs();
        
        // Періодичне оновлення
        setInterval(() => {
            this.refreshLogs();
        }, this.refreshInterval);
    }
    
    async refreshLogs() {
        const now = Date.now();
        if (now - this.lastRefresh < this.refreshInterval - 500) {
            return; // Запобігаємо занадто частим запитам
        }
        
        this.lastRefresh = now;
        
        try {
            const response = await fetch(`${this.apiBase}/logs?limit=100`);
            if (!response.ok) return;
            
            const data = await response.json();
            if (data.logs && Array.isArray(data.logs)) {
                this.displayLogs(data.logs);
            }
        } catch (error) {
            // Тихо ігноруємо помилки логів, щоб не спамити
        }
    }
    
    displayLogs(newLogs) {
        // Очищуємо контейнер
        this.logsContainer.innerHTML = '';
        
        // Показуємо останні логи (не більше maxLogs)
        const logsToShow = newLogs.slice(-this.maxLogs);
        
        logsToShow.forEach(log => {
            const logElement = document.createElement('div');
            logElement.className = `log-line ${log.level || 'info'}`;
            
            const timestamp = log.timestamp || new Date().toTimeString().split(' ')[0];
            const source = log.source ? `[${log.source}]` : '';
            const message = log.message || '';
            
            logElement.textContent = `${timestamp} ${source} ${message}`;
            this.logsContainer.appendChild(logElement);
        });
        
        // Автоскрол до низу
        this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
    }
    
    addLog(message, level = 'info', source = 'frontend') {
        const logEntry = {
            timestamp: new Date().toTimeString().split(' ')[0],
            level,
            source,
            message
        };
        
        this.logs.push(logEntry);
        
        // Обмежуємо кількість логів в пам'яті
        if (this.logs.length > this.maxLogs) {
            this.logs = this.logs.slice(-this.maxLogs);
        }
        
        // Додаємо до інтерфейсу
        const logElement = document.createElement('div');
        logElement.className = `log-line ${level}`;
        logElement.textContent = `${logEntry.timestamp} [${source}] ${message}`;
        
        this.logsContainer.appendChild(logElement);
        this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
        
        // Видаляємо старі елементи DOM
        while (this.logsContainer.children.length > this.maxLogs) {
            this.logsContainer.removeChild(this.logsContainer.firstChild);
        }
    }
    
    log(message, level = 'info') {
        const timestamp = new Date().toTimeString().split(' ')[0];
        console.log(`[${timestamp}] [LOGGER] ${message}`);
        this.addLog(message, level, 'logger');
    }
}

// Експортуємо для глобального використання
window.AtlasLogger = AtlasLogger;
