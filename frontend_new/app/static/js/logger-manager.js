/**
 * Atlas Logger Manager
 * Управління логами без спаму і зайвих запитів
 */
class AtlasLogger {
    constructor() {
        this.logs = [];
        this.maxLogs = 1000;
        this.apiBase = window.location.origin;
    this.refreshInterval = 20000; // 20s базовий інтервал
    this.fastInterval = 8000; // 8s при активності
    this.backoffMultiplier = 1.0;
    this.maxBackoff = 60000; // 60s максимум
    this.lastEtag = null;
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
            
            const baseInterval = shouldUseFastInterval ? this.fastInterval : this.refreshInterval;
            const currentInterval = Math.min(baseInterval * this.backoffMultiplier, this.maxBackoff);
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
            // Використовуємо новий unified logging endpoint замість окремих логів
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 секунд timeout
            
            const headers = { 'Cache-Control': 'no-cache' };
            if (this.lastEtag) headers['If-None-Match'] = this.lastEtag;
            const response = await fetch(`${this.apiBase}/api/unified-logs?tail=20`, {
                signal: controller.signal,
                headers
            });
            clearTimeout(timeoutId);
            
            if (response.status === 304) {
                // No changes
                this.backoffMultiplier = Math.max(1.0, this.backoffMultiplier * 0.9);
                return;
            }

            if (!response.ok) {
                this.backoffMultiplier = Math.min(this.backoffMultiplier * 1.5, this.maxBackoff / this.refreshInterval);
                return;
            }
            
            const data = await response.json();
            if (data.logs && Array.isArray(data.logs)) {
                this.displayUnifiedLogs(data.logs);
                // Успішний запит — зменшуємо backoff плавно
                this.backoffMultiplier = Math.max(1.0, this.backoffMultiplier * 0.8);
                const etag = response.headers.get('ETag');
                if (etag) this.lastEtag = etag;
            }
        } catch (error) {
            // Невдача — збільшуємо інтервал (експоненційний backoff)
            this.backoffMultiplier = Math.min(this.backoffMultiplier * 1.5, this.maxBackoff / this.refreshInterval);
            // Тихо ігноруємо помилки логів, щоб не спамити консоль
            // console.warn('[LOGGER] Skipping logs update:', error.name);
        }
    }
    
    displayUnifiedLogs(unifiedLogs) {
        // Парсимо unified log формат і показуємо красиво
        let appended = 0;
        for (const logLine of unifiedLogs) {
            // Парсимо формат: [2025-09-08 16:34:30] [INFO] [frontend] message
            const match = logLine.match(/\[([^\]]+)\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)/);
            if (!match) {
                // Якщо не вдалося розпарсити - показуємо як є
                const el = document.createElement('div');
                el.className = 'log-line info';
                // make logs half size, not bold, dim and green-blue
                el.style.cssText = 'font-size:0.85em;font-weight:normal;opacity:0.9;color:#0fa3a3;line-height:1.25;font-family:system-ui, "Segoe UI", Arial, sans-serif;';
                el.textContent = logLine.substring(0, 120); // Обрізаємо довгі рядки
                this.logsContainer.appendChild(el);
                appended++;
                continue;
            }

            const [_, timestamp, level, service, message] = match;
            
            // Скорочуємо timestamp (залишаємо тільки час)
            const shortTime = timestamp.split(' ')[1] || timestamp;
            
            // Очищуємо message від werkzeug деталей і дублювання дати
            let cleanMessage = message;
            
            // Прибираємо werkzeug префікс і деталі
            cleanMessage = cleanMessage.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \[INFO\] werkzeug: /, '');
            
            // Прибираємо IP та дублювання дати в werkzeug логах
            cleanMessage = cleanMessage.replace(/127\.0\.0\.1 - - \[\d{2}\/\w{3}\/\d{4} \d{2}:\d{2}:\d{2}\] /, '');
            
            // Для інших типів логів - прибираємо повторні дати
            cleanMessage = cleanMessage.replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} \[.+?\] /, '');
            
            // Скорочуємо повідомлення якщо довге
            const shortMessage = cleanMessage.length > 80 ? cleanMessage.substring(0, 80) + '...' : cleanMessage;
            
            // Створюємо елемент
            const el = document.createElement('div');
            el.className = `log-line ${level.toLowerCase()}`;
            // make logs half size, not bold, dim and green-blue
            el.style.cssText = 'font-size:0.85em;font-weight:normal;opacity:0.9;color:#0fa3a3;line-height:1.25;font-family:system-ui, "Segoe UI", Arial, sans-serif;';
            el.textContent = `[${shortTime}] [${service}] ${shortMessage}`;

            this.logsContainer.appendChild(el);
            appended++;
        }

        // Якщо переповнились, видаляємо лишнє зверху
        while (this.logsContainer.children.length > this.maxLogs) {
            this.logsContainer.removeChild(this.logsContainer.firstChild);
        }

        if (appended > 0) {
            this.lastActivity = Date.now();
            // Автоскрол вниз для нових логів
            this.logsContainer.scrollTop = this.logsContainer.scrollHeight;
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
            // make logs half size, not bold, dim and green-blue
            el.style.cssText = 'font-size:0.85em;font-weight:normal;opacity:0.9;color:#0fa3a3;line-height:1.25;font-family:system-ui, "Segoe UI", Arial, sans-serif;';
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
    // make logs half size, not bold, dim and green-blue
    logElement.style.cssText = 'font-size:0.85em;font-weight:normal;opacity:0.9;color:#0fa3a3;line-height:1.25;font-family:system-ui, "Segoe UI", Arial, sans-serif;';
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
