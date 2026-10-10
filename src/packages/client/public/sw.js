// Mu service worker.
//
// - App + API traffic: untouched (the browser goes straight to the network),
//   except navigations and same-origin /assets/* which are network-first with
//   a cache fallback so the app shell can open offline.
// - Offline music (docs/music-support-plan.md §6.5): the page downloads tracks
//   into the `music-offline` Cache Storage cache under a synthetic key per
//   track file (`/__mu-offline/track-file/<id>`, see
//   services/music-offline-index.ts). Any request for
//   `/music/files/<id>` is served from that cache when present — whatever
//   profile/caps query the player used — with correct Range (206) support,
//   so <audio> seeking works offline. Misses go to the network.
// - Album art under /music/art/ falls back to the offline cache when the
//   network fails.

const SHELL_CACHE = 'mu-shell-v1';
const MUSIC_CACHE = 'music-offline';
const SHELL_MAX_ENTRIES = 150;
const FILE_RE = /\/music\/files\/([^/?#]+)/;
const ART_RE = /\/music\/art\//;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((k) => k.startsWith('mu-shell-') && k !== SHELL_CACHE)
					.map((k) => caches.delete(k)),
			);
			await self.clients.claim();
		})(),
	);
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);

	const file = url.pathname.match(FILE_RE);
	if (file && !url.pathname.includes('/music/offline/')) {
		event.respondWith(serveMusicFile(req, decodeURIComponent(file[1])));
		return;
	}
	if (ART_RE.test(url.pathname)) {
		event.respondWith(networkThenCache(req, MUSIC_CACHE, false));
		return;
	}
	if (url.origin !== self.location.origin) return;
	if (req.mode === 'navigate') {
		event.respondWith(networkThenCache(req, SHELL_CACHE, true, '/'));
		return;
	}
	if (url.pathname.startsWith('/assets/')) {
		event.respondWith(networkThenCache(req, SHELL_CACHE, true));
	}
	// Everything else (API, uploads, media): no respondWith → plain network.
});

async function trim(cache) {
	const keys = await cache.keys();
	for (let i = 0; i < keys.length - SHELL_MAX_ENTRIES; i++) await cache.delete(keys[i]);
}

/** Network first; store successful responses (when `store`), fall back to the cache. */
async function networkThenCache(req, cacheName, store, cacheKey) {
	const cache = await caches.open(cacheName);
	try {
		const res = await fetch(req);
		const html = (res.headers.get('Content-Type') || '').includes('text/html');
		// The shell key ('/') only ever holds the SPA's index.html.
		if (store && res.ok && res.type === 'basic' && (!cacheKey || html)) {
			const copy = res.clone();
			cache
				.put(cacheKey || req, copy)
				.then(() => trim(cache))
				.catch(() => {});
		}
		return res;
	} catch (err) {
		const hit = await cache.match(cacheKey || req, { ignoreVary: true });
		if (hit) return hit;
		throw err;
	}
}

function offlineKey(trackFileId) {
	return new URL(`/__mu-offline/track-file/${encodeURIComponent(trackFileId)}`, self.location.origin)
		.href;
}

async function serveMusicFile(req, trackFileId) {
	let hit = null;
	try {
		const cache = await caches.open(MUSIC_CACHE);
		hit = await cache.match(offlineKey(trackFileId));
	} catch {
		hit = null;
	}
	if (!hit) return fetch(req);
	notifyHit(trackFileId);
	return rangeResponse(req, hit);
}

/** Tell open pages a cached track was used (drives LRU eviction). */
function notifyHit(trackFileId) {
	self.clients
		.matchAll({ type: 'window' })
		.then((clients) => {
			for (const c of clients) c.postMessage({ type: 'music-offline-hit', trackFileId });
		})
		.catch(() => {});
}

/** Build a 200 / 206 / 416 response for a cached full-body response. */
async function rangeResponse(req, cached) {
	const blob = await cached.blob();
	const size = blob.size;
	const type = cached.headers.get('Content-Type') || 'application/octet-stream';
	const range = req.headers.get('Range');
	if (!range) {
		return new Response(blob, {
			status: 200,
			headers: {
				'Content-Type': type,
				'Content-Length': String(size),
				'Accept-Ranges': 'bytes',
			},
		});
	}
	const parsed = parseRange(range, size);
	if (!parsed) {
		return new Response(null, {
			status: 416,
			headers: { 'Content-Range': `bytes */${size}` },
		});
	}
	const [start, end] = parsed;
	return new Response(blob.slice(start, end + 1, type), {
		status: 206,
		headers: {
			'Content-Type': type,
			'Content-Length': String(end - start + 1),
			'Content-Range': `bytes ${start}-${end}/${size}`,
			'Accept-Ranges': 'bytes',
		},
	});
}

/** Parse a single `bytes=` range (incl. suffix `bytes=-N`). Null when unsatisfiable. */
function parseRange(header, size) {
	const m = /^bytes=(\d*)-(\d*)$/.exec(header.split(',')[0].trim());
	if (!m || size === 0) return null;
	let start;
	let end;
	if (m[1] === '') {
		if (m[2] === '') return null;
		const n = Number(m[2]);
		if (n === 0) return null;
		start = Math.max(0, size - n);
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
	}
	if (start > end || start >= size) return null;
	return [start, end];
}
