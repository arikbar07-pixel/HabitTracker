const CACHE = 'myhabits-v4';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => {
  // Delete all old caches
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  );
  self.clients.claim();
});

// No fetch handler — browser fetches everything fresh from network
