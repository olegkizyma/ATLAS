/**
 * Development Cache Manager
 * Утиліти для управління кешем в режимі розробки
 */

class DevCacheManager {
    constructor() {
        this.isDevelopment = this.checkDevelopmentMode();
        if (this.isDevelopment) {
            this.init();
        }
    }

    checkDevelopmentMode() {
        // Перевіряємо наявність cache busting параметрів
        return window.location.search.includes('v=') || 
               document.querySelector('script[src*="?v="]') !== null ||
               window.location.hostname === 'localhost';
    }

    init() {
        // Додаємо кнопку очищення кешу в інтерфейс
        this.addCacheClearButton();
        
        // Додаємо keyboard shortcut
        this.setupKeyboardShortcuts();
        
        console.log('🔧 Dev Cache Manager initialized');
    }

    addCacheClearButton() {
        // Перевіряємо чи вже є кнопка
        if (document.getElementById('dev-cache-clear')) return;

        const button = document.createElement('button');
        button.id = 'dev-cache-clear';
        button.innerHTML = '🔄 Clear Cache';
        button.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 10000;
            padding: 5px 10px;
            background: #ff6b6b;
            color: white;
            border: none;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            opacity: 0.7;
            transition: opacity 0.3s;
        `;

        button.addEventListener('mouseenter', () => {
            button.style.opacity = '1';
        });

        button.addEventListener('mouseleave', () => {
            button.style.opacity = '0.7';
        });

        button.addEventListener('click', () => {
            this.clearAllCaches();
        });

        document.body.appendChild(button);
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+R для очищення кешу
            if (e.ctrlKey && e.shiftKey && e.key === 'R') {
                e.preventDefault();
                this.clearAllCaches();
            }
        });
    }

    async clearAllCaches() {
        console.log('🧹 Clearing all caches...');
        
        try {
            // 1. Викликаємо API очищення кешу
            const response = await fetch('/api/clear-cache');
            const result = await response.json();
            console.log('📡 Server cache cleared:', result);

            // 2. Очищаємо localStorage
            localStorage.clear();
            console.log('💾 localStorage cleared');

            // 3. Очищаємо sessionStorage  
            sessionStorage.clear();
            console.log('📝 sessionStorage cleared');

            // 4. Очищаємо Service Worker cache
            if ('serviceWorker' in navigator && 'caches' in window) {
                const cacheNames = await caches.keys();
                await Promise.all(
                    cacheNames.map(cacheName => caches.delete(cacheName))
                );
                console.log('🔧 Service Worker caches cleared');
            }

            // 5. Показуємо успішне повідомлення
            this.showNotification('✅ All caches cleared successfully!', 'success');

            // 6. Перезавантажуємо сторінку з примусовим оновленням
            setTimeout(() => {
                window.location.reload(true);
            }, 1000);

        } catch (error) {
            console.error('❌ Error clearing caches:', error);
            this.showNotification('❌ Error clearing caches', 'error');
        }
    }

    showNotification(message, type = 'info') {
        // Створюємо тимчасове повідомлення
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 50px;
            right: 10px;
            z-index: 10001;
            padding: 10px 15px;
            border-radius: 4px;
            color: white;
            font-size: 14px;
            font-weight: bold;
            background: ${type === 'success' ? '#51cf66' : type === 'error' ? '#ff6b6b' : '#339af0'};
            opacity: 0;
            transition: opacity 0.3s;
        `;

        notification.textContent = message;
        document.body.appendChild(notification);

        // Показати з анімацією
        requestAnimationFrame(() => {
            notification.style.opacity = '1';
        });

        // Приховати через 3 секунди
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // Метод для оновлення specific файлу
    async reloadFile(filename) {
        console.log(`🔄 Reloading ${filename}...`);
        
        if (filename.endsWith('.css')) {
            // Перезавантажити CSS файл
            const links = document.querySelectorAll(`link[href*="${filename}"]`);
            links.forEach(link => {
                const href = link.href.split('?')[0] + '?v=' + Date.now();
                link.href = href;
            });
        } else if (filename.endsWith('.js')) {
            // Для JS файлів потрібно перезавантажити сторінку
            window.location.reload();
        }
    }
}

// Ініціалізуємо якщо в dev режимі
if (typeof window !== 'undefined') {
    window.devCacheManager = new DevCacheManager();
}
