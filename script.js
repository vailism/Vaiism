import { authManager } from './js/AuthManager.js';
import { CloudSyncManager } from './js/cloud-sync.js';
import { WatchlistManager } from './js/watchlist.js';
import { WatchProgressManager } from './js/watch-progress.js';

// VAILISM - Netflix Clone Logic
// ─── Constants ───────────────────────────────────────────────────────────────
const BASE_URL      = '/api/tmdb';
const IMG_BASE_URL  = 'https://image.tmdb.org/t/p/w342';
const HERO_IMG_URL  = 'https://image.tmdb.org/t/p/w1280';
const FALLBACK_IMG  = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// requestIdleCallback polyfill for Safari/older browsers
window.requestIdleCallback = window.requestIdleCallback || function(cb) {
    var start = Date.now();
    return setTimeout(function() {
        cb({ didTimeout: false, timeRemaining: function() { return Math.max(0, 50 - (Date.now() - start)); } });
    }, 1);
};
window.cancelIdleCallback = window.cancelIdleCallback || function(id) { clearTimeout(id); };

// ─── Playback Freeze System ───────────────────────────────────────────────────
// When the modal player is active, ALL background network activity must stop.
// At 7 Mbps, the SERVER 1 HLS stream needs the full pipe — any competing
// fetches (image lazy-load, infinite scroll, prefetch) cause rebuffering.
let playbackActive = false;

function freezeBackground() {
    playbackActive = true;
    // Disconnect all IntersectionObservers to prevent scroll-triggered loads
    if (window._vailismVerticalObs)   window._vailismVerticalObs.disconnect();
    if (window._vailismHorizontalObs) window._vailismHorizontalObs.disconnect();
    // Stop all pending/loading images behind the modal
    document.querySelectorAll('img[loading="lazy"]').forEach(img => {
        if (!img.complete) img.dataset.frozenSrc = img.src;
    });
    console.log('[VAILISM] Background frozen — all bandwidth reserved for stream');
}

function thawBackground() {
    playbackActive = false;
    // Re-observe sentinels (they'll fire naturally when user scrolls)
    if (window._vailismVerticalObs && window._vailismVerticalSentinel) {
        window._vailismVerticalObs.observe(window._vailismVerticalSentinel);
    }
    // Horizontal observer will re-attach as user scrolls rows
    console.log('[VAILISM] Background thawed — network released');
}

const ENDPOINTS = [
    { title: 'Trending Now',     path: '/trending/all/week' },
    { title: 'Popular Choices',  path: '/movie/popular' },
    { title: 'Top Rated',        path: '/movie/top_rated' },
    { title: 'Action Hits',      path: '/discover/movie?with_genres=28' },
    { title: 'Comedy Hits',      path: '/discover/movie?with_genres=35' },
    { title: 'Horror',           path: '/discover/movie?with_genres=27' },
    { title: 'Sci-Fi & Fantasy', path: '/discover/movie?with_genres=878' },
    { title: 'Romance',          path: '/discover/movie?with_genres=10749' },
    { title: 'Documentaries',    path: '/discover/movie?with_genres=99' }
];

let globalCategoryIndex = 0;

// Debounced Lucide icon refresh — prevents calling createIcons() dozens of times
let lucideRafPending = false;
function refreshIcons() {
    if (lucideRafPending) return;
    lucideRafPending = true;
    requestAnimationFrame(function() {
        if (window.lucide) window.lucide.createIcons();
        lucideRafPending = false;
    });
}

// ─── Toast Notification System ────────────────────────────────────────────────
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
window.showToast = showToast;

// ─── Session Cache (survives page navigation) ─────────────────────────────────
// Stores TMDB API responses in sessionStorage so index→details→player
// never re-fetches the same data. Entries expire after 30 minutes.
const SESSION_CACHE_TTL = 30 * 60 * 1000; // 30 min

function sessionCacheGet(key) {
    try {
        const raw = sessionStorage.getItem('vc_' + key);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (Date.now() - entry.ts > SESSION_CACHE_TTL) {
            sessionStorage.removeItem('vc_' + key);
            return null;
        }
        return entry.data;
    } catch (e) { return null; }
}

function sessionCacheSet(key, data) {
    try {
        sessionStorage.setItem('vc_' + key, JSON.stringify({ data: data, ts: Date.now() }));
    } catch (e) {
        // sessionStorage full — evict oldest entries
        try {
            const keys = Object.keys(sessionStorage).filter(k => k.startsWith('vc_'));
            if (keys.length > 0) {
                sessionStorage.removeItem(keys[0]);
                sessionStorage.setItem('vc_' + key, JSON.stringify({ data: data, ts: Date.now() }));
            }
        } catch (e2) {}
    }
}

// ─── Safe localStorage helpers ────────────────────────────────────────────────────
function getProgressKey(movieId, mediaType, season, episode) {
    if (mediaType === 'tv') {
        const s = season !== undefined ? season : 1;
        const e = episode !== undefined ? episode : 1;
        return 'vailism_progress_' + movieId + '_s' + s + '_e' + e;
    }
    return 'vailism_progress_' + movieId;
}

// ─── IndexedDB Storage ─────────────────────────────────────────────────────────
const DB_NAME = 'vailism_db';
const DB_VERSION = 1;
const STORE_NAME = 'vailism_store';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
}

async function lsGet(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result !== undefined ? request.result : null);
            request.onerror = () => reject(request.error);
        });
    } catch(e) { return null; }
}

async function lsSet(key, value, skipBroadcast = false) {
    if (!key || value === undefined) return;
    
    if (key.startsWith('vailism_progress_')) {
        if (!isValidProgress(value)) return;
        value.id = parseInt(value.id, 10);
        value.timestamp = Math.max(0, Math.min(parseFloat(value.timestamp), parseFloat(value.duration)));
        value.duration = parseFloat(value.duration);
        value.updatedAt = Date.now();
        if (value.mediaType === 'tv') {
            value.season = parseInt(value.season, 10) || 1;
            value.episode = parseInt(value.episode, 10) || 1;
        }
    }
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.put(value, key);
            request.onsuccess = () => {
                if (!skipBroadcast && key.startsWith('vailism_')) {
                    try {
                        const bc = new BroadcastChannel('vailism_sync');
                        bc.postMessage({ type: 'UPDATE', key: key });
                        bc.close();
                    } catch(e) {}
                }
                // Push to Firestore if logged in
                if (auth_firebase && auth_firebase.currentUser && db_firestore && (key.startsWith('vailism_progress_') || key === 'vailism_watchlist')) {
                    const uid = auth_firebase.currentUser.uid;
                    db_firestore.collection('users').doc(uid).set({ [key]: value }, { merge: true })
                        .catch(err => console.error('[Sync] Firestore set failed:', err));
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } catch(e) {
        console.warn('[VAILISM] IDB Set failed:', e);
    }
}

async function lsRemove(key, skipBroadcast = false) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const request = store.delete(key);
            request.onsuccess = () => {
                if (!skipBroadcast && key.startsWith('vailism_')) {
                    try {
                        const bc = new BroadcastChannel('vailism_sync');
                        bc.postMessage({ type: 'UPDATE', key: key });
                        bc.close();
                    } catch(e) {}
                }
                // Remove from Firestore if logged in
                if (auth_firebase && auth_firebase.currentUser && db_firestore && (key.startsWith('vailism_progress_') || key === 'vailism_watchlist')) {
                    const uid = auth_firebase.currentUser.uid;
                    db_firestore.collection('users').doc(uid).update({
                        [key]: firebase.firestore.FieldValue.delete()
                    }).catch(err => console.error('[Sync] Firestore delete failed:', err));
                }
                resolve();
            };
            request.onerror = () => reject(request.error);
        });
    } catch(e) {
        console.warn('[VAILISM] IDB Remove failed:', e);
    }
}

async function lsKeys() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch(e) { return []; }
}

async function migrateFromLocalStorage() {
    try {
        const migrated = localStorage.getItem('vailism_idb_migrated');
        if (migrated) return;
        const keys = Object.keys(localStorage);
        for (const key of keys) {
            if (key.startsWith('vailism_')) {
                try {
                    let value = localStorage.getItem(key);
                    try { value = JSON.parse(value); } catch(e) {}
                    await lsSet(key, value, true);
                } catch(e) {}
            }
        }
        localStorage.setItem('vailism_idb_migrated', 'true');
        console.log('[VAILISM] Storage migrated to IndexedDB.');
    } catch(e) {}
}

async function getLatestProgressForShow(showId) {
    const keys = await lsKeys();
    const progressKeys = [];
    for (const k of keys) {
        if (k.startsWith('vailism_progress_' + showId)) {
            const data = await lsGet(k);
            if (data && data.updatedAt) progressKeys.push({ key: k, data: data });
        }
    }
    progressKeys.sort((a, b) => b.data.updatedAt - a.data.updatedAt);
    return progressKeys.length > 0 ? progressKeys[0].data : null;
}

function isValidProgress(data) {
    if (!data || typeof data !== 'object') return false;
    const id = parseInt(data.id, 10);
    const mediaType = data.mediaType;
    const ts = parseFloat(data.timestamp);
    const dur = parseFloat(data.duration);
    
    if (isNaN(id) || !mediaType || (mediaType !== 'movie' && mediaType !== 'tv')) return false;
    if (isNaN(ts) || isNaN(dur) || dur <= 0) return false;
    return true;
}

async function autoCleanup() {
    const keys = await lsKeys();
    const progressKeys = keys.filter(k => k.startsWith('vailism_progress_'));
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    for (const key of progressKeys) {
        const data = await lsGet(key);
        if (!data || !isValidProgress(data)) {
            await lsRemove(key, true);
            continue;
        }

        const age = now - (data.updatedAt || 0);
        if (age > thirtyDaysMs || data.timestamp <= 0 || data.timestamp >= data.duration) {
            await lsRemove(key, true);
        }
    }
}

// ─── API Cache & Fetch ────────────────────────────────────────────────────────
const apiCache = new Map();

async function fetchMovies(endpoint, page = 1) {
    // Block all fetches during playback to reserve bandwidth
    if (playbackActive) return apiCache.get(`${endpoint}-${page}`) || [];

    const cacheKey = `${endpoint}-${page}`;
    // Check in-memory first (fastest)
    if (apiCache.has(cacheKey)) return apiCache.get(cacheKey);
    // Check sessionStorage (survives navigation)
    const sessionCached = sessionCacheGet(cacheKey);
    if (sessionCached) {
        apiCache.set(cacheKey, sessionCached);
        return sessionCached;
    }

    try {
        const pathBlock   = encodeURIComponent(endpoint.split('?')[0]);
        const paramsBlock = endpoint.includes('?') ? (endpoint.split('?')[1] + '&') : '';
        const res = await fetch(`${BASE_URL}?path=${pathBlock}&${paramsBlock}page=${page}`);

        if (!res.ok) {
            if (res.status === 429) {
                console.warn('[VAILISM] Rate limit reached. Retrying in 1s…');
                await new Promise(r => setTimeout(r, 1000));
                return fetchMovies(endpoint, page);
            }
            throw new Error(`API Error: ${res.status}`);
        }

        const data    = await res.json();
        const results = data.results || [];
        if (results.length > 0) {
            apiCache.set(cacheKey, results);
            sessionCacheSet(cacheKey, results);
        }
        return results;
    } catch (e) {
        console.error('[VAILISM] fetchMovies failed:', e);
        return [];
    }
}

// Fetch single TMDB entity (movie/tv details). Uses both cache layers.
async function fetchDetails(type, id, signal) {
    const cacheKey = `detail_${type}_${id}`;
    // Layer 1: in-memory (fastest, no JSON.parse)
    if (apiCache.has(cacheKey)) return apiCache.get(cacheKey);
    // Layer 2: sessionStorage (survives navigation)
    const sessionCached = sessionCacheGet(cacheKey);
    if (sessionCached) {
        apiCache.set(cacheKey, sessionCached); // promote to L1
        return sessionCached;
    }
    // Layer 3: network fetch
    try {
        const fetchOptions = {};
        if (signal) fetchOptions.signal = signal;
        const res = await fetch(`${BASE_URL}?path=${encodeURIComponent('/' + type + '/' + id)}`, fetchOptions);
        if (!res.ok) return null;
        const data = await res.json();
        if (data && typeof data === 'object') {
            apiCache.set(cacheKey, data);
            sessionCacheSet(cacheKey, data);
        }
        return data;
    } catch (e) {
        return null;
    }
}

// ─── Connection Warmup ────────────────────────────────────────────────────────
// Inject <link rel="preconnect"> for SERVER 1 on first user interaction.
// This warms up DNS + TLS handshake before they click Play (~200-400ms saved).
let server1Warmed = false;
function warmPrimaryServer() {
    if (server1Warmed) return;
    server1Warmed = true;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = 'https://vidlink.pro';
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
}

// ─── Predictive Prefetch ──────────────────────────────────────────────────────
let prefetchInFlight = null;
let prefetchAbort = null; // AbortController for proper cancellation
function prefetchMovieDetails(movieId, type) {
    if (!movieId || !type || playbackActive) return;
    const cacheKey = `detail_${type}_${movieId}`;
    if (apiCache.has(cacheKey) || sessionCacheGet(cacheKey)) return;
    if (prefetchInFlight) return;
    prefetchInFlight = movieId;
    prefetchAbort = new AbortController();
    fetchDetails(type, movieId, prefetchAbort.signal).finally(() => {
        prefetchInFlight = null;
        prefetchAbort = null;
    });
}

function cancelPrefetch() {
    prefetchInFlight = null;
    if (prefetchAbort) {
        try { prefetchAbort.abort(); } catch (e) {}
        prefetchAbort = null;
    }
}

// ─── Modal Player System ──────────────────────────────────────────────────────
// Fullscreen overlay with iframe. Buffer-stabilized to prevent early reveal.

let activeModal = null;
let savedScrollY = 0;
let modalSaveThrottle = null; // progress save throttle

// ── Adaptive delay: detect network speed ─────────────────────────────────────
// Returns grace period (ms) to hold the loader AFTER iframe 'load' fires.
// This gives SERVER 1 time to fill its internal buffer before revealing video.
function getBufferGraceMs() {
    try {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (conn) {
            const etype = conn.effectiveType;
            const downlink = conn.downlink; // Mbps estimate
            if (etype === '4g' && downlink >= 10) return 800;   // Very fast: short grace
            if (etype === '4g') return 1500;                     // Normal 4G / WiFi
            if (etype === '3g') return 3000;                     // 3G: long buffer
            if (etype === '2g' || etype === 'slow-2g') return 5000; // Very slow
        }
    } catch (e) {}
    return 2000; // Default: ~7 Mbps range needs solid buffer time
}

const SERVERS = [
    {
        name: 'SERVER 1',
        description: 'Fastest server, supports Auto-Resume & Auto-Play.',
        pingUrl: 'https://vidlink.pro/',
        buildUrl: function(id, type, s, e, ts) {
            var startTimeParam = ts > 0 ? ('&startAt=' + Math.floor(ts)) : '';
            if (type === 'tv') {
                return 'https://vidlink.pro/tv/' + id + '/' + s + '/' + e + '?primaryColor=e50914&autoplay=true' + startTimeParam;
            }
            return 'https://vidlink.pro/movie/' + id + '?primaryColor=e50914&autoplay=true' + startTimeParam;
        }
    },
    {
        name: 'SERVER 2',
        description: 'Extremely reliable, fast streaming & high quality.',
        pingUrl: 'https://vidsrc.to/',
        buildUrl: function(id, type, s, e, ts) {
            if (type === 'tv') {
                return 'https://vidsrc.to/embed/tv/' + id + '/' + s + '/' + e;
            }
            return 'https://vidsrc.to/embed/movie/' + id;
        }
    },
    {
        name: 'SERVER 3',
        description: 'Fast, multi-source provider (videasy.net).',
        pingUrl: 'https://player.videasy.net/',
        buildUrl: function(id, type, s, e, ts) {
            var progressParam = ts > 0 ? ('?progress=' + Math.floor(ts)) : '';
            if (type === 'tv') {
                return 'https://player.videasy.net/tv/' + id + '/' + s + '/' + e + (progressParam ? progressParam + '&color=e50914' : '?color=e50914');
            }
            return 'https://player.videasy.net/movie/' + id + (progressParam ? progressParam + '&color=e50914' : '?color=e50914');
        }
    },
    {
        name: 'SERVER 4',
        description: 'Stable stream with good subtitle support.',
        pingUrl: 'https://vidsrc.xyz/',
        buildUrl: function(id, type, s, e, ts) {
            if (type === 'tv') {
                return 'https://vidsrc.xyz/embed/tv?tmdb=' + id + '&season=' + s + '&episode=' + e;
            }
            return 'https://vidsrc.xyz/embed/movie?tmdb=' + id;
        }
    }
];

// ── Auto-Select Fastest Server ───────────────────────────────────────────────
async function findFastestServer() {
    // Only run test if user hasn't manually selected a server recently
    if (sessionStorage.getItem('vailism_server_tested')) return;
    
    // Default fallback to SERVER 1 if no test finishes
    let bestServer = SERVERS[0];
    
    const promises = SERVERS.map(server => {
        return new Promise(resolve => {
            if (!server.pingUrl) return resolve({ server, latency: 9999 });
            const start = performance.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => { controller.abort(); resolve({ server, latency: 9999 }); }, 3000);
            
            fetch(server.pingUrl, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
                .then(() => {
                    clearTimeout(timeout);
                    resolve({ server, latency: performance.now() - start });
                })
                .catch(() => {
                    clearTimeout(timeout);
                    resolve({ server, latency: 9999 });
                });
        });
    });

    try {
        const results = await Promise.all(promises);
        
        // Mark offline servers
        results.forEach(r => {
            if (r.latency >= 5000) {
                r.server.isOffline = true;
            } else {
                r.server.isOffline = false;
            }
        });

        const validResults = results.filter(r => !r.server.isOffline);
        validResults.sort((a, b) => a.latency - b.latency);
        
        if (validResults.length > 0) {
            let fastest = validResults[0].server;
            
            const server1Res = validResults.find(r => r.server.name === 'SERVER 1');
            if (server1Res && server1Res.latency < 800) {
                fastest = SERVERS[0];
            }
            
            var preferredServerName = localStorage.getItem('vailism_preferred_server');
            var preferredServerObj = SERVERS.find(s => s.name === preferredServerName);

            // Override if user never picked a server, OR if their picked server is currently offline
            if (!preferredServerName || (preferredServerObj && preferredServerObj.isOffline)) {
                localStorage.setItem('vailism_preferred_server', fastest.name);
                console.log(`[VAILISM] Auto-selected fastest server (or previous was offline): ${fastest.name}`);
            }
        }
        sessionStorage.setItem('vailism_server_tested', 'true');
    } catch(e) {
        console.error('[VAILISM] Server speed test failed', e);
    }
}

function buildEmbedUrl(id, type, s, e, ts) {
    var preferredServerName = localStorage.getItem('vailism_preferred_server') || 'SERVER 1';
    var server = SERVERS.find(function(sv) { return sv.name === preferredServerName; }) || SERVERS[0];
    return server.buildUrl(id, type, s, e, ts);
}

function openModalPlayer(embedUrl, movieId, mediaType, seasonNum, episodeNum) {
    if (activeModal) return;

    // Cancel any in-flight prefetch to free bandwidth for the stream
    cancelPrefetch();

    // FREEZE all background network activity
    freezeBackground();

    savedScrollY = window.scrollY;
    warmPrimaryServer();

    // Determine current preferred server
    var preferredServerName = localStorage.getItem('vailism_preferred_server') || 'SERVER 1';
    var currentServer = SERVERS.find(function(sv) { return sv.name === preferredServerName; }) || SERVERS[0];

    // Create modal DOM
    const modal = document.createElement('div');
    modal.className = 'vailism-modal-player';
    modal.innerHTML = `
        <div class="vailism-modal-controls" id="modal-controls">
            <button class="vailism-modal-back" id="modal-back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
                Back
            </button>
            <div class="vailism-modal-right">
                <button class="vailism-server-btn" id="modal-party-btn" style="margin-right: 12px; background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.15);">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px; display: inline-block; vertical-align: middle;">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    Watch Together (beta)
                </button>
                <button class="vailism-server-btn" id="modal-next-ep-btn" style="display:none; margin-right: 12px; background: rgba(229, 9, 20, 0.85); border-color: #e50914;">
                    Next Ep
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-left: 4px;">
                        <polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line>
                    </svg>
                </button>
                <div class="vailism-server-container">
                    <button class="vailism-server-btn" id="modal-server-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line>
                        </svg>
                        Server: <span id="current-server-name">${currentServer.name}</span>
                    </button>
                    <div class="vailism-server-dropdown" id="modal-server-dropdown">
                        <div class="vailism-server-list" id="modal-server-list"></div>
                    </div>
                </div>
            </div>
        </div>
        <div class="vailism-modal-loader" id="modal-loader">
            <div class="vailism-modal-spinner"></div>
            <span>Loading...</span>
        </div>`;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    activeModal = modal;
    modal._movieId = movieId;
    modal._mediaType = mediaType;
    modal._season = seasonNum;
    modal._episode = episodeNum;
    modal._retryCount = 0;
    modal._serverSwitchCount = 0;
    modal._currentServerName = currentServer.name;
    modal._hasReceivedPlaybackEvent = false;
    modal._playbackCheckTimer = null;
    modal._nextSeason = null;
    modal._nextEpisode = null;

    var modalNextEpBtn = modal.querySelector('#modal-next-ep-btn');

    modal._checkNextEpisode = async function() {
        if (mediaType !== 'tv') return;
        try {
            var currentS = parseInt(modal._season, 10) || 1;
            var currentE = parseInt(modal._episode, 10) || 1;
            
            var seasonData = await fetchDetails('tv', movieId + '/season/' + currentS);
            var episodesInSeason = (seasonData && seasonData.episodes) ? seasonData.episodes.length : 0;
            
            if (currentE < episodesInSeason) {
                modal._nextSeason = currentS;
                modal._nextEpisode = currentE + 1;
                if (modalNextEpBtn) modalNextEpBtn.style.display = 'flex';
            } else {
                var tvData = await fetchDetails('tv', movieId);
                var totalSeasons = tvData ? tvData.number_of_seasons : 0;
                if (currentS < totalSeasons) {
                    modal._nextSeason = currentS + 1;
                    modal._nextEpisode = 1;
                    if (modalNextEpBtn) modalNextEpBtn.style.display = 'flex';
                } else {
                    if (modalNextEpBtn) modalNextEpBtn.style.display = 'none';
                    modal._nextSeason = null;
                    modal._nextEpisode = null;
                }
            }
        } catch(e) {
            console.error('[VAILISM] Error checking next episode', e);
        }
    };

    if (modalNextEpBtn) {
        modalNextEpBtn.onclick = async function(e) {
            e.stopPropagation();
            if (modal._nextSeason && modal._nextEpisode) {
                try { await lsRemove(getProgressKey(movieId, mediaType, modal._season, modal._episode)); } catch (err) {}
                modal._season = modal._nextSeason;
                modal._episode = modal._nextEpisode;
                modal._retryCount = 0;
                var nextUrl = buildEmbedUrl(movieId, mediaType, modal._season, modal._episode, 0);
                loadIframeInModal(modal, nextUrl);
                modalNextEpBtn.style.display = 'none';
                modal._checkNextEpisode();
            }
        };
    }
    
    modal._checkNextEpisode();

    modal._tryNextServer = function() {
        if (modal._serverSwitchCount >= SERVERS.length) {
            console.error('[VAILISM] Tried all servers, none loaded.');
            const loader = modal.querySelector('#modal-loader');
            if (loader) {
                var statusSpan = loader.querySelector('span');
                if (statusSpan) statusSpan.textContent = 'All streams failed. Please check connection.';
            }
            if (modal._stallTimer) { clearTimeout(modal._stallTimer); modal._stallTimer = null; }
            if (modal._playbackCheckTimer) { clearTimeout(modal._playbackCheckTimer); modal._playbackCheckTimer = null; }
            return;
        }

        modal._serverSwitchCount++;
        
        var currentIndex = SERVERS.findIndex(function(sv) { return sv.name === currentServer.name; });
        var nextIndex = currentIndex;
        
        // Find the next server that is NOT offline
        for (var i = 0; i < SERVERS.length; i++) {
            nextIndex = (nextIndex + 1) % SERVERS.length;
            if (!SERVERS[nextIndex].isOffline) {
                break;
            }
        }
        
        currentServer = SERVERS[nextIndex];

        console.warn('[VAILISM] Auto-switching to next server:', currentServer.name);
        
        localStorage.setItem('vailism_preferred_server', currentServer.name);
        
        var labelEl = modal.querySelector('#current-server-name');
        if (labelEl) labelEl.textContent = currentServer.name + ' (Auto)';
        
        modal._currentServerName = currentServer.name;
        modal._hasReceivedPlaybackEvent = false;
        if (modal._playbackCheckTimer) {
            clearTimeout(modal._playbackCheckTimer);
            modal._playbackCheckTimer = null;
        }
        resetModalControlsTimer();

        if (typeof renderModalServerList === 'function') {
            renderModalServerList();
        }
        
        var ts = 0;
        var storageKey = getProgressKey(movieId, mediaType, modal._season || seasonNum, modal._episode || episodeNum);
        try {
            var savedData = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (savedData && savedData.timestamp && savedData.duration) {
                var rawTs = parseFloat(savedData.timestamp);
                var dur = parseFloat(savedData.duration);
                if (rawTs > 0 && dur > 0 && rawTs < (dur - 10)) {
                    ts = Math.min(rawTs, dur - 5);
                }
            }
        } catch (err) {}
        
        var newUrl = currentServer.buildUrl(movieId, mediaType, modal._season || 1, modal._episode || 1, ts);
        loadIframeInModal(modal, newUrl);
    };

    requestAnimationFrame(() => { modal.classList.add('active'); });

    // ── Build iframe (hidden behind loader) ───────────────────────────────
    loadIframeInModal(modal, embedUrl);

    // ── Back button ───────────────────────────────────────────────────────
    const backBtn = modal.querySelector('#modal-back');
    if (backBtn) {
        backBtn.onclick = (ev) => { ev.stopPropagation(); closeModalPlayer(); };
    }

    // ── Watch Together (Party) Button ─────────────────────────────────────
    const modalPartyBtn = modal.querySelector('#modal-party-btn');
    if (modalPartyBtn) {
        modalPartyBtn.onclick = (ev) => {
            ev.stopPropagation();
            closeModalPlayer();
            const partyUrl = 'player.html?id=' + movieId + '&type=' + mediaType + 
                (modal._season ? '&s=' + modal._season : '') + 
                (modal._episode ? '&e=' + modal._episode : '') + 
                '&startParty=true';
            window.location.href = partyUrl;
        };
    }

    // ── ESC to close ──────────────────────────────────────────────────────
    modal._escHandler = (ev) => { if (ev.key === 'Escape') closeModalPlayer(); };
    document.addEventListener('keydown', modal._escHandler);

    // ── Server Selector Dropdown Rendering and Logic ──────────────────────
    var modalServerBtn = modal.querySelector('#modal-server-btn');
    var modalServerDropdown = modal.querySelector('#modal-server-dropdown');
    
    function renderModalServerList() {
        var listEl = modal.querySelector('#modal-server-list');
        if (!listEl) return;
        listEl.innerHTML = '';
        SERVERS.forEach(function(server) {
            var btn = document.createElement('button');
            btn.className = 'vailism-server-option' + (server.name === currentServer.name ? ' active' : '') + (server.isOffline ? ' offline' : '');
            if (server.isOffline) {
                btn.disabled = true;
                btn.style.opacity = '0.5';
                btn.style.cursor = 'not-allowed';
            }
            btn.innerHTML = `
                <span class="vailism-server-title">${server.name} ${server.isOffline ? '<span style="color:#ff4444;font-size:10px;margin-left:6px">(OFFLINE)</span>' : ''}</span>
                <span class="vailism-server-desc">${server.description}</span>
            `;
            btn.onclick = async function(e) {
                e.stopPropagation();
                if (server.isOffline) return;
                if (server.name === currentServer.name) return;
                currentServer = server;
                localStorage.setItem('vailism_preferred_server', server.name);
                modal.querySelector('#current-server-name').textContent = server.name;
                modalServerDropdown.classList.remove('show');
                
                // Reset retry count for the new server
                modal._retryCount = 0;
                modal._serverSwitchCount = 0;
                
                modal._currentServerName = server.name;
                modal._hasReceivedPlaybackEvent = false;
                if (modal._playbackCheckTimer) {
                    clearTimeout(modal._playbackCheckTimer);
                    modal._playbackCheckTimer = null;
                }
                resetModalControlsTimer();
                
                var ts = 0;
                var storageKey = getProgressKey(movieId, mediaType, modal._season, modal._episode);
                try {
                    var savedData = await lsGet(storageKey);
                    if (savedData && savedData.timestamp && savedData.duration) {
                        var rawTs = parseFloat(savedData.timestamp);
                        var dur = parseFloat(savedData.duration);
                        if (rawTs > 0 && dur > 0 && rawTs < (dur - 10)) {
                            ts = Math.min(rawTs, dur - 5);
                        }
                    }
                } catch (err) {}
                
                var newUrl = server.buildUrl(movieId, mediaType, modal._season || 1, modal._episode || 1, ts);
                loadIframeInModal(modal, newUrl);
                renderModalServerList();
            };
            listEl.appendChild(btn);
        });
    }

    if (modalServerBtn && modalServerDropdown) {
        renderModalServerList();
        
        modalServerBtn.onclick = function(e) {
            e.stopPropagation();
            modalServerDropdown.classList.toggle('show');
        };
        
        // Close dropdown when clicking outside
        modal._clickOutsideHandler = function(e) {
            if (!modalServerBtn.contains(e.target)) {
                modalServerDropdown.classList.remove('show');
                resetModalControlsTimer();
            }
        };
        document.addEventListener('click', modal._clickOutsideHandler);
    }

    // ── Controls Inactivity Hiding Logic ──────────────────────────────────
    var modalControls = modal.querySelector('#modal-controls');
    modal._hideControlsTimeout = null;

    function resetModalControlsTimer() {
        if (!modalControls) return;
        modalControls.style.opacity = '1';
        clearTimeout(modal._hideControlsTimeout);
        
        var shouldHide = (modal._currentServerName !== 'SERVER 1') || modal._hasReceivedPlaybackEvent;
        
        if (shouldHide) {
            modal._hideControlsTimeout = setTimeout(function() {
                if (modalServerDropdown && !modalServerDropdown.classList.contains('show')) {
                    modalControls.style.opacity = '0';
                }
            }, 3000);
        }
    }
    
    // Store helper to let cleanUp access and clear the timeout
    modal._resetControlsTimer = resetModalControlsTimer;

    var modalMouseMoveRaf = false;
    modal._mouseMoveHandler = function() {
        if (modalMouseMoveRaf) return;
        modalMouseMoveRaf = true;
        requestAnimationFrame(function() {
            resetModalControlsTimer();
            modalMouseMoveRaf = false;
        });
    };
    modal.addEventListener('mousemove', modal._mouseMoveHandler, { passive: true });
    
    modal._touchStartHandler = function() {
        resetModalControlsTimer();
    };
    modal.addEventListener('touchstart', modal._touchStartHandler, { passive: true });
    
    // Initial start of timer
    resetModalControlsTimer();

    // ── Progress tracking + auto-next-episode via postMessage ─────────────
    modal._msgHandler = (event) => {
        var payload = event.data;
        if (!payload) return;
        try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch (e) { return; }
        if (!payload || typeof payload !== 'object') return;

        if (payload.type === 'PLAYER_EVENT') {
            modal._hasReceivedPlaybackEvent = true;
            if (modal._playbackCheckTimer) {
                clearTimeout(modal._playbackCheckTimer);
                modal._playbackCheckTimer = null;
            }
            resetModalControlsTimer();
        }

        var data = (payload.type === 'PLAYER_EVENT' && payload.data) ? payload.data : payload;
        if (!data || typeof data !== 'object') return;

        var rawEvent = (data.event || data.type || '').toLowerCase();
        var evtName = rawEvent.includes('timeupdate') || rawEvent.includes('progress') ? 'timeupdate' :
                      rawEvent.includes('pause') ? 'pause' :
                      rawEvent.includes('ended') || rawEvent.includes('complete') ? 'ended' : rawEvent;

        var currentTime = parseFloat(data.currentTime !== undefined ? data.currentTime : (data.time !== undefined ? data.time : data.position)) || 0;
        var duration    = parseFloat(data.duration !== undefined ? data.duration : data.length) || 0;

        // Save progress (throttled to every 5 seconds)
        if ((evtName === 'timeupdate' || evtName === 'pause') && currentTime > 0 && duration > 0 && currentTime < duration) {
            if (!modalSaveThrottle) {
                modalSaveThrottle = setTimeout(() => { modalSaveThrottle = null; }, 5000);
                var storageKey = getProgressKey(movieId, mediaType, modal._season, modal._episode);
                var toSave = {
                    id: parseInt(movieId, 10),
                    mediaType: mediaType,
                    timestamp: Math.max(0, Math.min(currentTime, duration)),
                    duration: duration,
                    updatedAt: Date.now()
                };
                if (mediaType === 'tv') {
                    toSave.season  = parseInt(modal._season, 10) || 1;
                    toSave.episode = parseInt(modal._episode, 10) || 1;
                }
                try { lsSet(storageKey, toSave); } catch (e) {}
            }
        }

        // Auto-play next episode on video end (TV only)
        if (evtName === 'ended' && mediaType === 'tv') {
            // Clear current progress
            lsRemove(getProgressKey(movieId, mediaType, modal._season, modal._episode)).finally(() => {
                autoPlayNextEpisode(modal);
            });
        } else if (evtName === 'ended') {
            // Movie ended — clear progress
            lsRemove(getProgressKey(movieId, mediaType));
        }
    };
    window.addEventListener('message', modal._msgHandler);
}

// ── Load iframe with buffer stabilization ────────────────────────────────────
function loadIframeInModal(modal, embedUrl) {
    const loader = modal.querySelector('#modal-loader');
    // Remove any existing iframe (for retry/next-episode)
    const oldIframe = modal.querySelector('iframe');
    if (oldIframe) oldIframe.remove();

    // Show loader
    if (loader) { loader.classList.remove('hidden'); }

    if (modal._playbackCheckTimer) {
        clearTimeout(modal._playbackCheckTimer);
        modal._playbackCheckTimer = null;
    }
    modal._hasReceivedPlaybackEvent = false;

    const iframe = document.createElement('iframe');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('allow', 'autoplay; fullscreen; picture-in-picture');
    iframe.setAttribute('referrerpolicy', 'no-referrer-when-downgrade');

    let loaded = false;
    const graceMs = getBufferGraceMs();

    function revealPlayer() {
        if (loaded) return;
        loaded = true;
        // Hold loader for grace period AFTER iframe load to let stream buffer
        setTimeout(() => {
            if (loader) loader.classList.add('hidden');
        }, graceMs);
        // Clear stall timer
        if (modal._stallTimer) { clearTimeout(modal._stallTimer); modal._stallTimer = null; }

        // Start playback verification timer ONLY for SERVER 1
        if (modal._currentServerName === 'SERVER 1') {
            modal._playbackCheckTimer = setTimeout(() => {
                if (!modal._hasReceivedPlaybackEvent) {
                    console.warn('[VAILISM] SERVER 1 loaded but no playback events received within 8s. Content may be unavailable. Auto-switching...');
                    if (typeof modal._tryNextServer === 'function') {
                        modal._tryNextServer();
                    }
                }
            }, 8000); // 8 seconds post-load check
        }
    }

    iframe.addEventListener('load', revealPlayer);

    // ── Stall detection: if iframe doesn't load in 8s, auto-switch to next server ──
    modal._stallTimer = setTimeout(() => {
        if (!loaded) {
            console.warn('[VAILISM] Stall detected on current server. Triggering auto-fallback...');
            if (typeof modal._tryNextServer === 'function') {
                if (loader) {
                    var statusSpan = loader.querySelector('span');
                    if (statusSpan) statusSpan.textContent = 'Server stalled. Switching server...';
                }
                modal._tryNextServer();
            } else {
                // Final fallback: reveal whatever we have
                revealPlayer();
            }
        }
    }, 8000);

    // Set src LAST (starts loading after everything is wired up)
    iframe.src = embedUrl;
    modal.appendChild(iframe);
}

// ── Auto-play next episode ───────────────────────────────────────────────────
function autoPlayNextEpisode(modal) {
    if (!modal || modal !== activeModal) return;
    if (!modal._nextSeason || !modal._nextEpisode) return;
    
    var nextS = modal._nextSeason;
    var nextE = modal._nextEpisode;
    var movieId = modal._movieId;
    var mediaType = modal._mediaType;

    console.log('[VAILISM] Auto-playing next episode: S' + nextS + 'E' + nextE);

    // Update modal state
    modal._season = nextS;
    modal._episode = nextE;
    modal._retryCount = 0;
    
    var btn = modal.querySelector('#modal-next-ep-btn');
    if (btn) btn.style.display = 'none';

    // Build new URL and reload iframe in-place
    var nextUrl = buildEmbedUrl(movieId, mediaType, nextS, nextE, 0);
    loadIframeInModal(modal, nextUrl);

    // Update sessionStorage embed cache
    try {
        sessionStorage.setItem('vailism_precomputed_embed', JSON.stringify({
            id: movieId, type: mediaType, url: nextUrl,
            season: nextS, episode: nextE, ts: Date.now()
        }));
    } catch (e) {}
    
    // Check next episode availability again
    if (modal._checkNextEpisode) modal._checkNextEpisode();
}

function closeModalPlayer() {
    if (!activeModal) return;
    const modal = activeModal;
    activeModal = null;

    // Cleanup
    if (modal._escHandler) document.removeEventListener('keydown', modal._escHandler);
    if (modal._msgHandler) window.removeEventListener('message', modal._msgHandler);
    if (modal._clickOutsideHandler) document.removeEventListener('click', modal._clickOutsideHandler);
    if (modal._mouseMoveHandler) modal.removeEventListener('mousemove', modal._mouseMoveHandler);
    if (modal._touchStartHandler) modal.removeEventListener('touchstart', modal._touchStartHandler);
    if (modal._stallTimer) clearTimeout(modal._stallTimer);
    if (modal._playbackCheckTimer) clearTimeout(modal._playbackCheckTimer);
    if (modal._hideControlsTimeout) clearTimeout(modal._hideControlsTimeout);
    modalSaveThrottle = null;

    // THAW background activity
    thawBackground();

    modal.classList.remove('active');
    setTimeout(() => { modal.remove(); }, 300);

    document.body.style.overflow = '';
    window.scrollTo(0, savedScrollY);
}

window.playMovie = async function (id, type, s, e) {
    if (!id || id === 'undefined' || id === 'null') {
        console.warn('[VAILISM] Invalid ID provided to playMovie:', id);
        return;
    }
    type = type || 'movie';

    var ts = 0;
    var savedData = null;
    if (type === 'tv') {
        if (s && e) {
            savedData = await lsGet('vailism_progress_' + id + '_s' + s + '_e' + e);
        } else {
            savedData = await getLatestProgressForShow(id);
        }
    } else {
        savedData = await lsGet('vailism_progress_' + id);
    }

    if (savedData && savedData.timestamp && savedData.duration) {
        var rawTs = parseFloat(savedData.timestamp);
        var dur = parseFloat(savedData.duration);
        if (rawTs > 0 && dur > 0 && rawTs < (dur - 10)) {
            ts = Math.min(rawTs, dur - 5);
        }
    }
    var season  = s || (savedData && savedData.season) || 1;
    var episode = e || (savedData && savedData.episode) || 1;
    var embedUrl = buildEmbedUrl(id, type, season, episode, ts);

    // Stash for player.html fallback
    try {
        sessionStorage.setItem('vailism_precomputed_embed', JSON.stringify({
            id: id, type: type, url: embedUrl,
            season: season, episode: episode, ts: Date.now()
        }));
    } catch (ex) {}

    openModalPlayer(embedUrl, id, type, season, episode);
};

window.toggleMyList = async function (movie, btn) {
    if (!movie || !movie.id) return;
    try {
        const item = {
            tmdbId: parseInt(movie.id, 10),
            mediaType: movie.media_type || (movie.name ? 'tv' : 'movie'),
            title: movie.title || movie.name || 'Unknown Title',
            poster: movie.poster_path || '',
            backdrop: movie.backdrop_path || ''
        };
        
        const added = await WatchlistManager.toggleWatchlist(item);
        if (btn) {
            if (added) btn.classList.add('added');
            else btn.classList.remove('added');
        }
        if (window.lucide) window.lucide.createIcons();
    } catch (e) {
        console.warn('[VAILISM] toggleMyList error:', e);
    }
};

// ─── DOM Ready ────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

    // ── Navbar scroll effect (throttled, null-safe) ─────────────────────
    // Defer autoCleanup to idle time — not critical for first paint
    if (window.requestIdleCallback) {
        requestIdleCallback(autoCleanup);
    } else {
        setTimeout(autoCleanup, 200);
    }
    const navbar = document.getElementById('navbar');
    if (navbar) {
        let scrollTicking = false;
        window.addEventListener('scroll', () => {
            if (scrollTicking) return;
            scrollTicking = true;
            requestAnimationFrame(() => {
                navbar.classList.toggle('scrolled', window.scrollY > 50);
                scrollTicking = false;
            });
        }, { passive: true });
    }

    // ── Hero Banner ───────────────────────────────────────────────────────────
    async function loadHeroBanner() {
        const movies = await fetchMovies('/trending/all/week');
        if (!movies || movies.length === 0) return;

        const baseMovie = movies[Math.floor(Math.random() * Math.min(movies.length, 5))];
        const type      = baseMovie.media_type || (baseMovie.name ? 'tv' : 'movie');

        // Only fetch full details if trending data lacks genres (common for /trending)
        let movie = baseMovie;
        if (!baseMovie.genres || baseMovie.genres.length === 0) {
            const fullDetails = await fetchDetails(type, baseMovie.id);
            if (fullDetails) movie = fullDetails;
        }
        // Cache this movie's details for when user clicks "More Info"
        sessionCacheSet('detail_' + type + '_' + movie.id, movie);

        // DOM refs — all guarded
        const heroTitle  = document.getElementById('hero-title');
        const heroDesc   = document.getElementById('hero-desc');
        const heroPlay   = document.getElementById('hero-play');
        const heroInfo   = document.getElementById('hero-info');
        const heroHeader = document.getElementById('hero');
        const heroMeta   = document.getElementById('hero-meta');
        const heroRating = document.getElementById('hero-rating');
        const heroYear   = document.getElementById('hero-year');
        const heroRuntime= document.getElementById('hero-runtime');
        const heroGenres = document.getElementById('hero-genres');

        // Remove skeleton loaders
        if (heroTitle) heroTitle.classList.remove('skeleton-text');
        if (heroDesc)  heroDesc.classList.remove('skeleton-text');

        // Metadata
        const year   = (movie.release_date || movie.first_air_date || '').split('-')[0];
        const rating = movie.vote_average ? ((movie.vote_average * 10).toFixed(0) + '% Match') : '';

        let runtimeText = '';
        if (type === 'movie' && movie.runtime) {
            runtimeText = `${Math.floor(movie.runtime / 60)}h ${movie.runtime % 60}m`;
        } else if (type === 'tv' && movie.number_of_seasons) {
            runtimeText = `${movie.number_of_seasons} Season${movie.number_of_seasons > 1 ? 's' : ''}`;
        } else if (type === 'tv' && movie.episode_run_time && movie.episode_run_time.length > 0) {
            runtimeText = `${movie.episode_run_time[0]}m`;
        }

        if (heroRating)  heroRating.textContent  = rating;
        if (heroYear)    heroYear.textContent     = year;
        if (heroRuntime) heroRuntime.textContent  = runtimeText;
        if (heroMeta)    heroMeta.style.opacity   = '1';

        if (heroGenres && movie.genres && movie.genres.length > 0) {
            heroGenres.innerHTML = movie.genres
                .map(g => `<span class="genre-pill">${g.name}</span>`)
                .join('');
            heroGenres.style.display = 'flex';
            heroGenres.style.gap = '8px';
            heroGenres.style.flexWrap = 'wrap';
        }

        // Preload hero background image before painting it
        const heroBg = movie.backdrop_path || movie.poster_path;
        if (heroBg && heroHeader) {
            const bgUrl = `${HERO_IMG_URL}${heroBg}`;
            const preloadImg = new Image();
            preloadImg.fetchPriority = 'high';
            preloadImg.onload = () => {
                heroHeader.style.backgroundImage = `url(${bgUrl})`;
            };
            preloadImg.src = bgUrl;
        }

        if (heroTitle) heroTitle.textContent = movie.title || movie.name || 'Featured Movie';
        if (heroDesc)  heroDesc.textContent  = movie.overview || 'An amazing movie to watch on VAILISM.';

        // Play button — use onclick (not addEventListener) to automatically replace previous handler
        if (heroPlay) {
            heroPlay.style.display = 'flex';
            heroPlay.onclick = () => window.playMovie(movie.id, type);
            // Warm SERVER 1 connection when user hovers over Play
            heroPlay.addEventListener('mouseenter', warmPrimaryServer, { passive: true });
        }

        // More Info button
        if (heroInfo) {
            heroInfo.style.display = 'flex';
            heroInfo.onclick = () => window.location.href = `details.html?id=${movie.id}&type=${type}`;
        }

        // My List (hidden by CSS, shown only if button exists in DOM)
        const btnList = document.querySelector('.btn-list');
        if (btnList) {
            btnList.style.display = 'flex';
            const watchlistData = await lsGet('vailism_watchlist');
            const myList = (watchlistData && Array.isArray(watchlistData.items)) ? watchlistData.items : [];
            if (myList.some(m => String(m.id || m.tmdbId) === String(movie.id))) {
                btnList.classList.add('added');
            }
            btnList.onclick = () => window.toggleMyList(movie, btnList);
        }

        refreshIcons();
    }

    // ── Card Builder ──────────────────────────────────────────────────────────
    function appendMoviesToContainer(movies, container) {
        if (!container || !movies || movies.length === 0) return;

        const fragment   = document.createDocumentFragment();
        const existingIds = new Set(
            Array.from(container.querySelectorAll('.card'))
                .map(c => c.dataset.id)
                .filter(Boolean)
        );

        movies.forEach(movie => {
            if (!movie.poster_path && !movie.backdrop_path) return;
            if (existingIds.has(String(movie.id))) return;
            existingIds.add(String(movie.id));

            const type = movie.media_type || (movie.name ? 'tv' : 'movie');

            const card = document.createElement('div');
            card.classList.add('card');
            card.dataset.id = String(movie.id);
            card.dataset.type = type;
            // Set onclick as HTML attribute to survive PWA / DOM virtualization serialization
            card.setAttribute('onclick', `window.location.href='details.html?id=${movie.id}&type=${type}'`);

            const imgPath = movie.poster_path || movie.backdrop_path;
            const imgSrc  = imgPath ? `${IMG_BASE_URL}${imgPath}` : FALLBACK_IMG;

            card.innerHTML = `
                <span class="card-rating">★ ${movie.vote_average ? movie.vote_average.toFixed(1) : ''}</span>
                <img src="${imgSrc}"
                     alt="${(movie.title || movie.name || 'Movie').replace(/"/g, '&quot;')}"
                     loading="lazy"
                     decoding="async"
                     width="342"
                     height="513"
                     style="aspect-ratio:2/3;object-fit:cover;"
                     onload="this.classList.add('loaded')"
                     onerror="this.src='${FALLBACK_IMG}'">
                <div class="card-info-btn"
                     onclick="event.stopPropagation(); window.location.href='details.html?id=${movie.id}&amp;type=${type}'">
                    <i data-lucide="info" size="14"></i>
                </div>
                <div class="card-overlay">
                    <span style="font-weight:600;font-size:14px;text-shadow:1px 1px 2px rgba(0,0,0,1);color:#fff;">
                        ${movie.title || movie.name || ''}
                    </span>
                    <div class="play-icon"
                         onclick="event.stopPropagation(); window.playMovie('${movie.id}','${type}')">
                        <i data-lucide="play" fill="currentColor" size="16"></i>
                    </div>
                </div>`;

            // Add progress bar if user has watched this
            const progressKey = type === 'tv' 
                ? `vailism_progress_${movie.id}` 
                : `vailism_progress_${movie.id}`;
            try {
                const allKeys = Object.keys(localStorage);
                for (const k of allKeys) {
                    if (k.startsWith(`vailism_progress_${movie.id}`)) {
                        const pd = JSON.parse(localStorage.getItem(k));
                        if (pd && pd.progressPercent && pd.progressPercent > 2 && pd.progressPercent < 95) {
                            const progDiv = document.createElement('div');
                            progDiv.className = 'card-progress';
                            progDiv.innerHTML = `<div class="card-progress-bar" style="width:${pd.progressPercent}%"></div>`;
                            card.appendChild(progDiv);
                            break;
                        }
                    }
                }
            } catch(e) {}

            fragment.appendChild(card);
        });

        // Sync check for already loaded/cached images to prevent transition flash
        fragment.querySelectorAll('img').forEach(img => {
            if (img.complete) {
                img.classList.add('loaded');
            }
        });

        container.appendChild(fragment);
        refreshIcons();
    }

    // ── Horizontal Infinite Scroll ────────────────────────────────────────────
    const horizontalObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (playbackActive) return; // Don't load during playback
            if (!entry.isIntersecting) return;
            const rowSection = entry.target.closest('section.row');
            if (!rowSection) return;
            const rowPosters = rowSection.querySelector('.row-posters');
            if (!rowPosters) return;
            observer.unobserve(entry.target);
            loadNextHorizontalPage(rowPosters, rowSection, observer);
        });
    }, { rootMargin: '0px 300px 0px 0px' });
    
    // Expose for freeze/thaw system
    window._vailismHorizontalObs = horizontalObserver;

    async function loadNextHorizontalPage(rowElement, rowSection, activeObserver) {
        if (rowElement.dataset.fetching === 'true') return;
        rowElement.dataset.fetching = 'true';

        const nextPage = (parseInt(rowSection.dataset.page, 10) || 1) + 1;
        rowSection.dataset.page = nextPage;

        const path   = rowSection.dataset.path;
        const movies = await fetchMovies(path, nextPage);

        appendMoviesToContainer(movies, rowElement);
        rowElement.dataset.fetching = '';

        const cards = rowElement.querySelectorAll('.card');
        if (cards.length > 0) activeObserver.observe(cards[cards.length - 1]);
    }

    // ── Row Virtualization (Windowing) ────────────────────────────────────────
    const rowVisibilityObserver = new IntersectionObserver((entries) => {
        if (typeof playbackActive !== 'undefined' && playbackActive) return; // Prevent layout thrashing and image fetching during video playback
        entries.forEach(entry => {
            const row = entry.target;
            const postersContainer = row.querySelector('.row-posters');
            if (!postersContainer) return;

            if (entry.isIntersecting) {
                if (postersContainer.dataset.pruned === 'true') {
                    postersContainer.dataset.pruned = 'false';
                    postersContainer.innerHTML = postersContainer.dataset.cachedHtml || '';
                    postersContainer.style.height = ''; 
                    
                    const cards = postersContainer.querySelectorAll('.card');
                    if (cards.length > 0 && window._vailismHorizontalObs) {
                        window._vailismHorizontalObs.observe(cards[cards.length - 1]);
                    }
                    if (typeof refreshIcons === 'function') refreshIcons();
                }
            } else {
                if (postersContainer.dataset.pruned !== 'true' && postersContainer.children.length > 0) {
                    const rect = postersContainer.getBoundingClientRect();
                    postersContainer.style.height = rect.height + 'px';
                    postersContainer.dataset.cachedHtml = postersContainer.innerHTML;
                    postersContainer.innerHTML = '';
                    postersContainer.dataset.pruned = 'true';
                }
            }
        });
    }, { rootMargin: '1200px 0px 1200px 0px' });

    // ── Row Rendering ─────────────────────────────────────────────────────────
    async function renderRow(categoryDef) {
        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        rowSection.dataset.page = '1';
        rowSection.dataset.path = categoryDef.path;

        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = categoryDef.title;

        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');

        // Skeleton placeholders
        for (let i = 0; i < 6; i++) {
            const sk = document.createElement('div');
            sk.classList.add('card', 'skeleton-card');
            rowPosters.appendChild(sk);
        }

        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        mainContent.appendChild(rowSection);
        rowVisibilityObserver.observe(rowSection);

        const movies = await fetchMovies(categoryDef.path, 1);
        rowPosters.innerHTML = '';

        if (movies && movies.length > 0) {
            appendMoviesToContainer(movies, rowPosters);
            const cards = rowPosters.querySelectorAll('.card');
            if (cards.length > 0) horizontalObserver.observe(cards[cards.length - 1]);
        } else {
            rowPosters.style.display = 'block';
            rowPosters.innerHTML = `
                <div style="padding:20px;color:#ff4444;background:rgba(229,9,20,0.1);
                            border:1px solid #e50914;border-radius:4px;display:inline-block;">
                    <strong>Backend Offline.</strong><br>
                    Run <code>npm start</code> locally or deploy to Vercel.
                </div>`;
        }
    }

    // ── Continue Watching ─────────────────────────────────────────────────────
    async function loadContinueWatching() {
        const rawKeys = await lsKeys();
        const keys = rawKeys.filter(k => k.startsWith('vailism_progress_'));

        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        // Fetch and validate entries
        const items = WatchProgressManager.getAllProgress();
        for (const key of keys) {
            const data = await lsGet(key);
            items.push({ key, data });
        }
        
        if (items.length === 0) return;
        
        const validatedEntries = items
            .filter(item => isValidProgress(item.data))
            .sort((a, b) => (b.data.updatedAt || 0) - (a.data.updatedAt || 0));

        // Group by show/movie ID to only keep the most recently updated progress for each title
        const groupedMap = new Map();
        validatedEntries.forEach(item => {
            const mappedId = item.data.tmdbId || item.data.id;
            if (!groupedMap.has(mappedId)) {
                groupedMap.set(mappedId, item);
            }
        });

        const progressEntries = Array.from(groupedMap.values()).slice(0, 10);

        if (progressEntries.length === 0) return;

        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = 'Continue Watching';
        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');

        mainContent.insertBefore(rowSection, mainContent.firstChild);
        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        rowVisibilityObserver.observe(rowSection);

        const fetchPromises = progressEntries.map(async item => {
            const savedData = item.data;
            const movieId   = savedData.tmdbId || savedData.id;
            const typePath  = savedData.mediaType;
            const ts        = savedData.currentTime || savedData.timestamp;
            const dur       = savedData.duration;

            try {
                const data = await fetchDetails(typePath, movieId);
                if (!data || (!data.poster_path && !data.backdrop_path)) return;

                const imgPath        = data.poster_path || data.backdrop_path;
                const percentComplete = Math.min(100, Math.max(0, (ts / dur) * 100));
                const title           = (data.title || data.name || 'Movie').replace(/"/g, '&quot;');

                const card = document.createElement('div');
                card.classList.add('card');
                card.dataset.id = movieId;
                card.dataset.type = typePath;
                // Set onclick as HTML attribute to survive virtualization serialization
                card.setAttribute('onclick', `window.location.href='details.html?id=${movieId}&type=${typePath}'`);

                card.innerHTML = `
                    <img src="${IMG_BASE_URL}${imgPath}"
                         alt="${title}"
                         loading="lazy"
                         decoding="async"
                         onload="this.classList.add('loaded')"
                         onerror="this.src='${FALLBACK_IMG}'">
                    <div style="height:4px;width:100%;background:rgba(255,255,255,0.2);
                                position:absolute;bottom:0;left:0;">
                        <div style="height:100%;width:${percentComplete.toFixed(1)}%;
                                    background:var(--primary-red);"></div>
                    </div>
                    <div class="card-info-btn"
                         onclick="event.stopPropagation();
                                  window.location.href='details.html?id=${movieId}&amp;type=${typePath}'">
                        <i data-lucide="info" size="14"></i>
                    </div>
                    <div class="card-overlay">
                        <span style="font-weight:600;font-size:14px;
                                     text-shadow:1px 1px 2px rgba(0,0,0,1);color:#fff;">
                            ${data.title || data.name || ''}
                        </span>
                        <div class="play-icon"
                             onclick="event.stopPropagation();
                                      window.playMovie('${movieId}','${typePath}', ${savedData.season || 'undefined'}, ${savedData.episode || 'undefined'})">
                            <i data-lucide="play" fill="currentColor" size="16"></i>
                        </div>
                    </div>`;

                rowPosters.appendChild(card);

                // Sync check for loaded
                const imgEl = card.querySelector('img');
                if (imgEl && imgEl.complete) {
                    imgEl.classList.add('loaded');
                }

                // Warm SERVER 1 connection on hover (details already cached)
                card.addEventListener('mouseenter', warmPrimaryServer, { passive: true });
            } catch (e) {
                console.warn('[VAILISM] Continue Watching fetch failed for', item.key, e);
            }
        });

        await Promise.all(fetchPromises);

        // Remove the section entirely if nothing loaded
        if (rowPosters.children.length === 0) {
            rowSection.remove();
        } else {
            refreshIcons();
        }
    }

    // ── Watchlist / My List ──────────────────────────────────────────────────
    async function loadWatchlist() {
        const watchlistData = await lsGet('vailism_watchlist');
        const legacyItems = (watchlistData && Array.isArray(watchlistData.items)) ? watchlistData.items : [];
        const currentItems = WatchlistManager.getWatchlist();
        
        // Merge and deduplicate based on tmdbId/id
        const mergedMap = new Map();
        [...legacyItems, ...currentItems].forEach(item => {
            const mappedId = item.tmdbId || item.id;
            if (!mergedMap.has(mappedId)) {
                mergedMap.set(mappedId, item);
            }
        });
        
        const items = Array.from(mergedMap.values());
        if (items.length === 0) return;

        const mainContent = document.getElementById('main-content');
        if (!mainContent) return;

        // Sort items by addedAt descending
        const sortedItems = items
            .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
            .slice(0, 10);

        if (sortedItems.length === 0) return;

        const rowSection = document.createElement('section');
        rowSection.classList.add('row');
        const rowHeader = document.createElement('h2');
        rowHeader.classList.add('row-header');
        rowHeader.textContent = 'My List';
        const rowPosters = document.createElement('div');
        rowPosters.classList.add('row-posters');

        // Insert after "Continue Watching" if it exists, otherwise at the very top of mainContent
        const firstRow = mainContent.firstChild;
        if (firstRow && firstRow.classList && firstRow.querySelector('.row-header') && firstRow.querySelector('.row-header').textContent === 'Continue Watching') {
            mainContent.insertBefore(rowSection, firstRow.nextSibling);
        } else {
            mainContent.insertBefore(rowSection, mainContent.firstChild);
        }
        rowSection.appendChild(rowHeader);
        rowSection.appendChild(rowPosters);
        rowVisibilityObserver.observe(rowSection);

        const fetchPromises = sortedItems.map(async item => {
            const movieId   = item.tmdbId || item.id;
            const typePath  = item.mediaType;

            try {
                const data = await fetchDetails(typePath, movieId);
                if (!data || (!data.poster_path && !data.backdrop_path)) return;

                const imgPath        = data.poster_path || data.backdrop_path;
                const title           = (data.title || data.name || 'Movie').replace(/"/g, '&quot;');

                const card = document.createElement('div');
                card.classList.add('card');
                card.dataset.id = movieId;
                card.dataset.type = typePath;
                // Set onclick as HTML attribute to survive virtualization serialization
                card.setAttribute('onclick', `window.location.href='details.html?id=${movieId}&type=${typePath}'`);

                card.innerHTML = `
                    <img src="${IMG_BASE_URL}${imgPath}"
                         alt="${title}"
                         loading="lazy"
                         decoding="async"
                         onload="this.classList.add('loaded')"
                         onerror="this.src='${FALLBACK_IMG}'">
                    <div class="card-info-btn"
                         onclick="event.stopPropagation();
                                  window.location.href='details.html?id=${movieId}&amp;type=${typePath}'">
                        <i data-lucide="info" size="14"></i>
                    </div>
                    <div class="card-overlay">
                        <span style="font-weight:600;font-size:14px;
                                     text-shadow:1px 1px 2px rgba(0,0,0,1);color:#fff;">
                            ${data.title || data.name || ''}
                        </span>
                        <div class="play-icon"
                             onclick="event.stopPropagation();
                                      window.playMovie('${movieId}','${typePath}')">
                            <i data-lucide="play" fill="currentColor" size="16"></i>
                        </div>
                    </div>`;

                rowPosters.appendChild(card);

                // Sync check for loaded
                const imgEl = card.querySelector('img');
                if (imgEl && imgEl.complete) {
                    imgEl.classList.add('loaded');
                }

                // Warm SERVER 1 connection on hover
                card.addEventListener('mouseenter', warmPrimaryServer, { passive: true });
            } catch (e) {
                console.warn('[VAILISM] Watchlist fetch failed for', movieId, e);
            }
        });

        await Promise.all(fetchPromises);

        // Remove the section entirely if nothing loaded
        if (rowPosters.children.length === 0) {
            rowSection.remove();
        } else {
            refreshIcons();
        }
    }

    // ── Vertical Infinite Scroll (sentinel-based) ─────────────────────────────
    let isFetchingVertical = false;

    async function loadMoreRows() {
        if (isFetchingVertical) return;
        isFetchingVertical = true;

        for (let i = 0; i < 2; i++) {
            if (globalCategoryIndex < ENDPOINTS.length) {
                await renderRow(ENDPOINTS[globalCategoryIndex]);
                globalCategoryIndex++;
            }
        }

        isFetchingVertical = false;
    }

    const mainContent = document.getElementById('main-content');
    if (mainContent) {
        const sentinel    = document.createElement('div');
        sentinel.id       = 'vertical-sentinel';
        sentinel.style.height = '10px';
        mainContent.after(sentinel);

        const verticalObserver = new IntersectionObserver(entries => {
            if (playbackActive) return; // Don't load during playback
            if (entries[0].isIntersecting) loadMoreRows();
        }, { rootMargin: '0px 0px 500px 0px' });

        verticalObserver.observe(sentinel);

        // Expose for freeze/thaw system
        window._vailismVerticalObs = verticalObserver;
        window._vailismVerticalSentinel = sentinel;
    }

    // ── Search ────────────────────────────────────────────────────────────────
    const searchIcon      = document.querySelector('.search-icon');
    const searchContainer = document.querySelector('.search-container');
    const searchInput     = document.getElementById('search-input');
    const appContent      = document.getElementById('app-content');
    const searchView      = document.getElementById('search-view');
    const searchResults   = document.getElementById('search-results');

    function closeSearch() {
        if (searchContainer) searchContainer.classList.remove('active');
        if (searchInput)     searchInput.value = '';
        if (searchView)      searchView.classList.add('hidden');
        if (appContent)      appContent.classList.remove('hidden');
    }

    if (searchIcon && searchContainer && searchInput) {
        searchIcon.addEventListener('click', () => {
            searchContainer.classList.toggle('active');
            if (searchContainer.classList.contains('active')) {
                searchInput.focus();
            } else {
                closeSearch();
            }
        });
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(null, args), delay);
        };
    }

    async function searchMovies(query) {
        if (!query || !query.trim()) {
            if (searchView)  searchView.classList.add('hidden');
            if (appContent) appContent.classList.remove('hidden');
            return;
        }

        if (appContent) appContent.classList.add('hidden');
        if (searchView) searchView.classList.remove('hidden');

        if (searchResults) {
            searchResults.innerHTML = '';
            for (let i = 0; i < 10; i++) {
                const sk = document.createElement('div');
                sk.classList.add('card', 'skeleton-card');
                searchResults.appendChild(sk);
            }
        }

        const movies = await fetchMovies(`/search/multi?query=${encodeURIComponent(query)}&include_adult=false`, 1);

        if (searchResults) {
            searchResults.innerHTML = '';
            if (!movies || movies.length === 0) {
                searchResults.innerHTML = '<h3 style="color:var(--text-muted);">No results found.</h3>';
                return;
            }
            appendMoviesToContainer(movies, searchResults);
        }
    }

    if (searchInput) {
        const debouncedSearch = debounce(e => searchMovies(e.target.value), 500);
        searchInput.addEventListener('input', debouncedSearch);

        // Escape key search dismissal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && searchContainer && searchContainer.classList.contains('active')) {
                closeSearch();
            }
        });
    }

    // ── Boot ────────────────────────────────────────────────────────────────────
    if (document.getElementById('hero') && document.getElementById('search-input')) {
        // Run migration first
        migrateFromLocalStorage().then(() => {
            // Priority 1: Hero banner (above the fold)
            loadHeroBanner();
            // Priority 2: Continue Watching & rows (deferred to idle)
            const deferredBoot = function() {
                loadContinueWatching();
                loadWatchlist();
                loadMoreRows();
            };
            if (window.requestIdleCallback) {
                requestIdleCallback(deferredBoot, { timeout: 1500 });
            } else {
                setTimeout(deferredBoot, 100);
            }
            
            // Sync UI across tabs
            try {
                const bc = new BroadcastChannel('vailism_sync');
                bc.onmessage = (event) => {
                    if (event.data && event.data.type === 'UPDATE') {
                        // Refresh Watchlist and Continue Watching rows
                        const rows = document.querySelectorAll('section.row');
                        rows.forEach(r => {
                            const header = r.querySelector('.row-header');
                            if (header && (header.textContent === 'My List' || header.textContent === 'Continue Watching')) {
                                r.remove();
                            }
                        });
                        loadContinueWatching();
                        loadWatchlist();
                    }
                };
            } catch(e) {}
            
            // BFCache recovery
            window.addEventListener('pageshow', (event) => {
                if (event.persisted) {
                    const rows = document.querySelectorAll('section.row');
                    rows.forEach(r => {
                        const header = r.querySelector('.row-header');
                        if (header && (header.textContent === 'My List' || header.textContent === 'Continue Watching')) {
                            r.remove();
                        }
                    });
                    loadContinueWatching();
                    loadWatchlist();
                }
            });
        });
    }

    // ── PWA Install Logic ───────────────────────────────────────────────────────
    let deferredPrompt;
    const installAppBtn = document.getElementById('installAppBtn');

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        if (installAppBtn) {
            installAppBtn.style.display = 'block';
            installAppBtn.onclick = async () => {
                deferredPrompt.prompt();
                const { outcome } = await deferredPrompt.userChoice;
                deferredPrompt = null;
                installAppBtn.style.display = 'none';
            };
        }
    });

    // Global predictive hover delegation (handles virtualized/windowed cards automatically)
    document.addEventListener('mouseover', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        
        if (typeof warmPrimaryServer === 'function') warmPrimaryServer();
        
        const id = card.dataset.id;
        const type = card.dataset.type;
        if (id && type && typeof prefetchMovieDetails === 'function') {
            prefetchMovieDetails(id, type);
        }
    }, { passive: true });

    // Run background server speed test
    findFastestServer();
    
    // Initialize Auth & Sync System
    if (typeof initAuthSync === 'function') initAuthSync();

    // ── Offline Detection ────────────────────────────────────────────────────
    const offlineBanner = document.getElementById('offline-banner');
    function updateOnlineStatus() {
        if (offlineBanner) {
            if (!navigator.onLine) {
                offlineBanner.classList.add('show');
                showToast('You\'re offline — showing cached content', 'error');
            } else {
                offlineBanner.classList.remove('show');
            }
        }
    }
    window.addEventListener('online', () => { updateOnlineStatus(); showToast('Back online!', 'success'); });
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

    // ── Keyboard Shortcuts ───────────────────────────────────────────────────
    document.addEventListener('keydown', (e) => {
        // '/' focuses search (unless already in an input)
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            const sc = document.querySelector('.search-container');
            const si = document.getElementById('search-input');
            if (sc && si) { sc.classList.add('active'); si.focus(); }
        }
        // Escape closes any modal
        if (e.key === 'Escape') {
            const authModal = document.getElementById('account-modal');
            if (authModal && !authModal.classList.contains('hidden')) {
                authModal.classList.add('hidden');
            }
        }
    });
});

// ── Smart TV Keyboard Navigation (Spatial Navigation) ──────────────────────
let focusableSelector = '.card, #search-input, #installAppBtn, .hero-buttons button, .logo';
let focusedElement = null;

function getFocusableElements() {
    return Array.from(document.querySelectorAll(focusableSelector)).filter(el => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
    });
}

function setSpatialFocus(el) {
    if (!el) return;
    if (focusedElement) focusedElement.classList.remove('spatial-focus');
    focusedElement = el;
    focusedElement.classList.add('spatial-focus');
    
    // Scroll into view
    const rect = el.getBoundingClientRect();
    if (rect.top < 100 || rect.bottom > window.innerHeight - 50) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    
    // If it's a card in a row, scroll the row horizontally
    const rowPosters = el.closest('.row-posters');
    if (rowPosters) {
        const parentRect = rowPosters.getBoundingClientRect();
        if (rect.left < parentRect.left + 50 || rect.right > parentRect.right - 50) {
            rowPosters.scrollBy({ left: rect.left - parentRect.left - parentRect.width / 2 + rect.width / 2, behavior: 'smooth' });
        }
        // Trigger hover logic (prefetch/warm)
        el.dispatchEvent(new MouseEvent('mouseenter'));
    }
}

document.addEventListener('keydown', (e) => {
    // Only process if modal is not active
    if (document.querySelector('.vailism-modal-player')) return;
    // Don't intercept if user is typing in search
    if (document.activeElement === document.getElementById('search-input') && e.key !== 'ArrowDown' && e.key !== 'Escape' && e.key !== 'Enter') return;

    const keys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'];
    if (!keys.includes(e.key)) return;

    if (e.key === 'Enter') {
        if (focusedElement) {
            if (focusedElement.id === 'search-input') {
                focusedElement.focus();
            } else {
                focusedElement.click();
            }
        }
        return;
    }

    e.preventDefault();
    
    const els = getFocusableElements();
    if (els.length === 0) return;

    if (!focusedElement || !els.includes(focusedElement)) {
        setSpatialFocus(els[0]);
        return;
    }

    const currentRect = focusedElement.getBoundingClientRect();
    let bestMatch = null;
    let minDistance = Infinity;

    els.forEach(el => {
        if (el === focusedElement) return;
        const rect = el.getBoundingClientRect();
        
        let isCandidate = false;
        let dist = 0;

        const dx = (rect.left + rect.width/2) - (currentRect.left + currentRect.width/2);
        const dy = (rect.top + rect.height/2) - (currentRect.top + currentRect.height/2);

        // Allow loose Y matching for horizontal moves to catch adjacent rows slightly off alignment
        if (e.key === 'ArrowRight' && dx > 0 && Math.abs(dy) < 150) isCandidate = true;
        if (e.key === 'ArrowLeft'  && dx < 0 && Math.abs(dy) < 150) isCandidate = true;
        // Allow loose X matching for vertical moves
        if (e.key === 'ArrowDown'  && dy > 0 && Math.abs(dx) < 300) isCandidate = true;
        if (e.key === 'ArrowUp'    && dy < 0 && Math.abs(dx) < 300) isCandidate = true;

        if (isCandidate) {
            const distance = Math.sqrt(dx*dx + dy*dy);
            if (distance < minDistance) {
                minDistance = distance;
                bestMatch = el;
            }
        }
    });

    if (bestMatch) setSpatialFocus(bestMatch);
});

// Main logic coordinator
async function initAuthSync() {
    const profileBtn = document.getElementById('profileBtn');
    const modal = document.getElementById('account-modal');
    const closeBtn = document.getElementById('closeAccountModalBtn');
    
    if (!profileBtn || !modal) return;

    // Modal toggles
    profileBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
    });
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    });

    // Tab switching
    const authTabs = document.querySelectorAll('.auth-tab-btn');
    const authPanes = document.querySelectorAll('.auth-tab-pane');
    authTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            authTabs.forEach(t => t.classList.remove('active'));
            authPanes.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const targetPane = document.getElementById(tab.dataset.tab);
            if (targetPane) targetPane.classList.add('active');
        });
    });

    // Password toggles
    document.querySelectorAll('.pwd-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (input.type === 'password') {
                input.type = 'text';
                btn.innerHTML = '<i data-lucide="eye-off"></i>';
            } else {
                input.type = 'password';
                btn.innerHTML = '<i data-lucide="eye"></i>';
            }
            if (window.lucide) lucide.createIcons();
        });
    });

    if (!authManager) {
        console.warn('AuthManager could not be initialized. Check Firebase config.');
        return;
    }

    // Forms
    const signInForm = document.getElementById('signInForm');
    const signUpForm = document.getElementById('signUpForm');
    
    // Elements
    const signInEmail = document.getElementById('signInEmail');
    const signInPassword = document.getElementById('signInPassword');
    const rememberMe = document.getElementById('rememberMe');
    const signInError = document.getElementById('signInError');
    const signInBtn = document.getElementById('signInBtn');

    const signUpUsername = document.getElementById('signUpUsername');
    const signUpEmail = document.getElementById('signUpEmail');
    const signUpPassword = document.getElementById('signUpPassword');
    const signUpConfirmPassword = document.getElementById('signUpConfirmPassword');
    const signUpError = document.getElementById('signUpError');
    const signUpBtn = document.getElementById('signUpBtn');

    // Google Buttons
    const googleSignInBtn = document.getElementById('googleSignInBtn');
    const googleSignUpBtn = document.getElementById('googleSignUpBtn');

    // Profile View Elements
    const loggedInProfileView = document.getElementById('loggedInProfileView');
    const profileName = document.getElementById('profileName');
    const profileEmail = document.getElementById('profileEmail');
    const profileLogoutBtn = document.getElementById('profileLogoutBtn');

    // Listen to Auth State
    authManager.onAuthStateChanged(async (user) => {
        if (user) {
            localStorage.setItem('vailism_current_user', user.uid);
            localStorage.setItem('vailism_current_user_email', user.email);
            
            // Show logged-in UI
            signInForm.classList.add('hidden');
            loggedInProfileView.classList.remove('hidden');
            profileName.textContent = user.displayName || 'User';
            profileEmail.textContent = user.email;
            
            // Auto switch to sign-in tab if not there
            document.getElementById('tabSignInHeader').click();
            document.getElementById('tabSignInHeader').textContent = "Profile";
            if (document.getElementById('tabSignUpHeader')) {
                document.getElementById('tabSignUpHeader').style.display = 'none';
            }
            
        } else {
            localStorage.removeItem('vailism_current_user');
            localStorage.removeItem('vailism_current_user_email');
            
            // Show logged-out UI
            signInForm.classList.remove('hidden');
            loggedInProfileView.classList.add('hidden');
            document.getElementById('tabSignInHeader').textContent = "Sign In";
            if (document.getElementById('tabSignUpHeader')) {
                document.getElementById('tabSignUpHeader').style.display = 'block';
            }
        }
    });

    // Handle Sign In
    signInForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        signInError.textContent = '';
        signInBtn.disabled = true;
        signInBtn.textContent = 'Signing in...';

        const { user, error } = await authManager.signIn(
            signInEmail.value.trim(), 
            signInPassword.value, 
            rememberMe.checked
        );

        if (error) {
            signInError.textContent = error;
        } else {
            modal.classList.add('hidden');
        }
        signInBtn.disabled = false;
        signInBtn.textContent = 'Continue Watching';
    });

    // Handle Sign Up
    signUpForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        signUpError.textContent = '';
        
        if (signUpPassword.value !== signUpConfirmPassword.value) {
            signUpError.textContent = 'Passwords do not match.';
            return;
        }

        signUpBtn.disabled = true;
        signUpBtn.textContent = 'Creating account...';

        const { user, error } = await authManager.signUp(
            signUpEmail.value.trim(),
            signUpPassword.value,
            signUpUsername.value.trim()
        );

        if (error) {
            signUpError.textContent = error;
        } else {
            modal.classList.add('hidden');
        }
        signUpBtn.disabled = false;
        signUpBtn.textContent = 'Create Free Account';
    });

    // Handle Google Auth
    const handleGoogleAuth = async () => {
        const { user, error } = await authManager.signInWithGoogle();
        if (error) {
            signInError.textContent = error;
            if (signUpError) signUpError.textContent = error;
        } else {
            modal.classList.add('hidden');
        }
    };
    if (googleSignInBtn) googleSignInBtn.addEventListener('click', handleGoogleAuth);
    if (googleSignUpBtn) googleSignUpBtn.addEventListener('click', handleGoogleAuth);

    // Logout
    profileLogoutBtn.addEventListener('click', async () => {
        await authManager.signOut();
    });

    // Auto-open auth modal if redirect query parameter exists
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('openAuth')) {
        const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
        window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        profileBtn.click();
    }
}

