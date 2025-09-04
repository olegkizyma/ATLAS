/**
 * Atlas Logger Manager
 * Управління логами без спаму і зайвих запитів
 */
class AtlasLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.apiBase = window.location.origin;
        this.refreshInterval = 15000; // 15 секунд замість 10 - менше навантаження
        this.fastInterval = 5000; // 5 секунд замість 3 - менше спаму
        this.lastRefresh = 0;
        this.lastActivity = Date.now();
        this.isActive = false;
        this.lastLogTimestamp = null; // Трекінг останнього лога для оптимізації
        
        this.init();
    }
    
    init() {
        // Выбираем контейнер логов в зависимости от вьюпорта (десктоп/мобайл)
        this.logsContainer = this.selectLogsContainerByViewport();
        
        if (!this.logsContainer) {
            console.error('Logs container not found');
            return;
        }
        
        // Переключение контейнера при изменении размера экрана (между десктопом и мобилкой)
        const onViewportChange = () => {
            const next = this.selectLogsContainerByViewport();
            if (next && next !== this.logsContainer) {
                // Переносим уже отрисованные логи в новый контейнер, сохраняя порядок
                try {
                    const fragment = document.createDocumentFragment();
                    while (this.logsContainer.firstChild) {
                        fragment.appendChild(this.logsContainer.firstChild);
                    }
                    next.appendChild(fragment);
                } catch (_) { /* no-op */ }
                this.logsContainer = next;
                // Форсим обновление, чтобы подтянуть свежие логи в новый контейнер
                this.refreshLogs();
            }
        };
        window.addEventListener('resize', onViewportChange);
        window.addEventListener('orientationchange', onViewportChange);
        // Небольшая задержка на случай поздней инициализации вкладок мобильного UI
        setTimeout(onViewportChange, 500);

        this.startLogStream();
        this.log('Atlas Logger initialized');
    }

    selectLogsContainerByViewport() {
        const isMobile = window.matchMedia('(max-width: 768px)').matches;
        const mobile = document.getElementById('logs-container');
        const desktop = document.getElementById('logs-container-desktop');
        if (isMobile) {
            return mobile || desktop || null;
        }
        return desktop || mobile || null;
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
            // Додаємо timeout для запитів
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 секунд timeout
            
            const response = await fetch(`${this.apiBase}/logs?limit=100`, {
                signal: controller.signal,
                headers: {
                    'Cache-Control': 'no-cache'
                }
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) return;
            
            const data = await response.json();
            if (data.logs && Array.isArray(data.logs)) {
                this.displayLogs(data.logs);
            }
        } catch (error) {
            // Тихо ігноруємо помилки логів, щоб не спамити консоль
            // console.warn('[LOGGER] Skipping logs update:', error.name);
        }
    }
    
    displayLogs(newLogs) {
        // Не очищуємо контейнер! Логи повинні накопичуватися
        // Нормализуем и сортируем по времени по возрастанию, чтобы порядок был корректным
        const normalizeTime = (t) => new Date(t || Date.now()).getTime();
        const sorted = [...newLogs].sort((a, b) => normalizeTime(a.timestamp) - normalizeTime(b.timestamp));

        let appended = 0;
        for (const log of sorted) {
            const logTime = normalizeTime(log.timestamp);
            const lastTime = this.lastLogTimestamp ? normalizeTime(this.lastLogTimestamp) : -Infinity;
            if (logTime <= lastTime) continue; // пропускаем уже показанные

            const tsStr = log.timestamp || new Date().toTimeString().split(' ')[0];
            const source = log.source ? `[${log.source}]` : '';
            const message = log.message || '';

            const el = document.createElement('div');
            el.className = `log-line ${log.level || 'info'}`;
            el.textContent = `${tsStr} ${source} ${message}`;

            // Добавляем вниз (хронологически), чтобы порядок сохранялся
            this.logsContainer.appendChild(el);
            this.lastLogTimestamp = log.timestamp || new Date().toISOString();
            appended++;
        }

        // Если переполнились, удаляем лишнее сверху
        while (this.logsContainer.children.length > this.maxLogs) {
            this.logsContainer.removeChild(this.logsContainer.firstChild);
        }

        if (appended > 0) {
            this.lastActivity = Date.now();
        }
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
