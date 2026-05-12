const CACHE_NAME = 'techcross-v4';
const PRECACHE = ['/', '/index.html', '/pricing.html', '/styles.css', '/logo-sm.png', '/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    // Delete ALL old caches
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    var url = e.request.url;
    // API, inv-*, staff-portal, admin-*: ALWAYS network only
    if (url.includes('/api/') || url.includes('/inv-') || url.includes('/staff-portal') || url.includes('/admin')) {
        e.respondWith(fetch(e.request));
        return;
    }
    // Static assets only: cache first
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
        var clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
    })));
});
