/**
 * Atlas Service Worker
 * Кешування для швидшої роботи
 */

const CACHE_NAME = 'atlas-v2.0';
const CACHE_URLS = [
    '/',
    '/static/css/main.css',
    '/static/js/app.js',
    '/static/js/chat-manager.js',
    '/static/js/logger-manager.js',
    '/static/js/status-manager.js',
    '/static/assets/atlas-icon.svg',
    '/static/assets/favicon.ico'
];

// Установка Service Worker
self.addEventListener('install', event => {
    console.log('SW: Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// Активація Service Worker
self.addEventListener('activate', event => {
    console.log('SW: Activating...');
    event.waitUntil(
        caches.keys()
            .then(cacheNames => Promise.all(
                cacheNames
                    .filter(cacheName => cacheName !== CACHE_NAME)
                    .map(cacheName => caches.delete(cacheName))
            ))
            .then(() => self.clients.claim())
    );
});

// Перехоплення запитів
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Пропускаємо API запити
    if (url.pathname.startsWith('/api/')) {
        return;
    }
    
    // Пропускаємо SSE стріми
    if (url.pathname.includes('/stream/')) {
        return;
    }
    
    // Кешування статичних ресурсів
    if (url.pathname.startsWith('/static/') || url.pathname === '/') {
        event.respondWith(
            caches.match(request)
                .then(response => {
                    if (response) {
                        // Повертаємо з кешу
                        return response;
                    }
                    
                    // Завантажуємо та кешуємо
                    return fetch(request)
                        .then(response => {
                            if (response.status === 200) {
                                const responseClone = response.clone();
                                caches.open(CACHE_NAME)
                                    .then(cache => cache.put(request, responseClone));
                            }
                            return response;
                        });
                })
                .catch(() => {
                    // Fallback для офлайн режиму
                    if (url.pathname === '/') {
                        return caches.match('/');
                    }
                })
        );
    }
});
