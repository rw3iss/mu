// Minimal service worker for PWA installability.
// Does not cache anything — the app always fetches from the network.
// This exists solely to satisfy the PWA install criteria.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
	event.respondWith(fetch(event.request));
});
