/**
 * Atlas Logger Manager
 * Управління логами без спаму і зайвих запитів
 */
class AtlasLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.apiBase = window.location.origin;
        this.refreshInterval = 10000; // 10 секунд замість 3 - менше спаму
        this.fastInterval = 3000; // швидкий режим коли є активність
        this.lastRefresh = 0;
        this.lastActivity = Date.now();
        this.isActive = false;
        
        this.init();
    }
    
    init() {
        this.logsContainer = document.getElementById('logs-container');
        
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
        
        // Адаптивне періодичне оновлення
        setInterval(() => {
            // Використовуємо швидкий інтервал, якщо була нещодавня активність
            const timeSinceActivity = Date.now() - this.lastActivity;
            const shouldUseFastInterval = timeSinceActivity < 60000; // 1 хвилина
            
            const currentInterval = shouldUseFastInterval ? this.fastInterval : this.refreshInterval;
            const timeSinceRefresh = Date.now() - this.lastRefresh;
            
            if (timeSinceRefresh >= currentInterval) {
                this.refreshLogs();
            }
        }, 2000); // Перевіряємо кожні 2 секунди, але рефрешимо рідше
        
        // Трекінг активності користувача для оптимізації
        document.addEventListener('mouseenter', () => {
            this.lastActivity = Date.now();
        });
        document.addEventListener('click', () => {
            this.lastActivity = Date.now();
        });
    }
    
    async refreshLogs() {
        const now = Date.now();
        const timeSinceActivity = now - this.lastActivity;
        
        // Пропускаємо оновлення, якщо немає активності більше 5 хвилин
        if (timeSinceActivity > 300000) {
            return;
        }
        
        // Запобігаємо занадто частим запитам
        const minInterval = timeSinceActivity < 60000 ? this.fastInterval - 500 : this.refreshInterval - 500;
        if (now - this.lastRefresh < minInterval) {
            return;
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
        
        // Показуємо останні логи (не більше maxLogs) - від нових до старих
        const logsToShow = newLogs.slice(-this.maxLogs).reverse();
        
        logsToShow.forEach(log => {
            const logElement = document.createElement('div');
            logElement.className = `log-line ${log.level || 'info'}`;
            
            const timestamp = log.timestamp || new Date().toTimeString().split(' ')[0];
            const source = log.source ? `[${log.source}]` : '';
            const message = log.message || '';
            
            logElement.textContent = `${timestamp} ${source} ${message}`;
            this.logsContainer.appendChild(logElement);
        });
        
        // Залишаємо скрол зверху (не скролимо вниз)
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
        
        // Додаємо до інтерфейсу (зверху)
        const logElement = document.createElement('div');
        logElement.className = `log-line ${level}`;
        logElement.textContent = `${logEntry.timestamp} [${source}] ${message}`;
        
        // Вставляємо новий лог зверху (як перший елемент)
        this.logsContainer.insertBefore(logElement, this.logsContainer.firstChild);
        
        // Залишаємо скрол зверху (не міняємо scrollTop)
        
        // Видаляємо старі елементи DOM (знизу)
        while (this.logsContainer.children.length > this.maxLogs) {
            this.logsContainer.removeChild(this.logsContainer.lastChild);
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
