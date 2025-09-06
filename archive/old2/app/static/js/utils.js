/**
 * ATLAS Frontend v2.0 - Utilities
 * Загальні утилітарні функції
 */

// Утиліти для форматування часу
window.timeUtils = {
    getCurrentTime() {
        return new Date().toLocaleTimeString();
    },
    
    formatTimestamp(timestamp) {
        return new Date(timestamp).toLocaleTimeString();
    }
};

// Утиліти для DOM
window.domUtils = {
    createElement(tag, className, textContent) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (textContent) element.textContent = textContent;
        return element;
    },
    
    scrollToBottom(element) {
        element.scrollTop = element.scrollHeight;
    }
};

// Утиліти для API запитів
window.apiUtils = {
    async get(url) {
        try {
            const response = await fetch(url);
            return await response.json();
        } catch (error) {
            console.error('API GET error:', error);
            return null;
        }
    },
    
    async post(url, data) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data)
            });
            return await response.json();
        } catch (error) {
            console.error('API POST error:', error);
            return null;
        }
    }
};

// Утиліти для дебагінгу
window.debugUtils = {
    log(message, data = null) {
        console.log(`[ATLAS] ${message}`, data || '');
    },
    
    error(message, error = null) {
        console.error(`[ATLAS ERROR] ${message}`, error || '');
    }
};
