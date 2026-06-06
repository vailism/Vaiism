const CACHE_NAME = 'vailism-shell-v6';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/details.html',
    '/style.css',
    '/party.css',
    '/script.js',
    '/details.js',
    '/favicon/favicon.ico',
    '/logo.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            console.log('[SW] Caching app shell v6');
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.map(key => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Removing old cache', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    // Only intercept same-origin requests (exclude API and external images/iframes)
    if (event.request.url.startsWith(self.location.origin) && !event.request.url.includes('/api/')) {
        // Stale-While-Revalidate: serve cached version immediately, update cache in background
        event.respondWith(
            caches.open(CACHE_NAME).then(cache => {
                return cache.match(event.request).then(cachedResponse => {
                    const fetchPromise = fetch(event.request).then(networkResponse => {
                        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                            cache.put(event.request, networkResponse.clone());
                        }
                        return networkResponse;
                    }).catch(() => {
                        // Offline fallback for HTML pages
                        if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
                            return cache.match('/index.html');
                        }
                        return cachedResponse;
                    });
                    // Return cached immediately, fetch in background
                    return cachedResponse || fetchPromise;
                });
            })
        );
    }
});
