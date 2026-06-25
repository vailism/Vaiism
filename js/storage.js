/**
 * VAILISM — Shared Storage Module
 *
 * Single source of truth for all persistent storage operations.
 * All reads and writes go through IndexedDB (vailism_db / vailism_store).
 *
 * Previously, WatchProgressManager wrote to localStorage and script.js /
 * player.html each opened their own separate IDB databases, making data
 * impossible to synchronise reliably. This module fixes that.
 */

const DB_NAME    = 'vailism_db';
const DB_VERSION = 1;
const STORE_NAME = 'vailism_store';

// ── Open / reuse DB connection ─────────────────────────────────────────────────
let _dbPromise = null;

export function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = () => { _dbPromise = null; reject(request.error); };
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
    });
    return _dbPromise;
}

// ── CRUD helpers ───────────────────────────────────────────────────────────────
export async function lsGet(key) {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx      = db.transaction(STORE_NAME, 'readonly');
            const store   = tx.objectStore(STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result !== undefined ? request.result : null);
            request.onerror   = () => reject(request.error);
        });
    } catch (e) { return null; }
}

export async function lsSet(key, value, skipBroadcast = false) {
    if (!key || value === undefined) return;

    // Normalise and validate progress entries before writing
    if (key.startsWith('vailism_progress_')) {
        if (!isValidProgress(value)) return;
        value = { ...value };
        value.id        = parseInt(value.id  !== undefined ? value.id  : value.tmdbId, 10);
        value.tmdbId    = value.id;
        value.timestamp = Math.max(0, Math.min(parseFloat(value.timestamp  || value.currentTime || 0), parseFloat(value.duration)));
        value.duration  = parseFloat(value.duration);
        value.updatedAt = Date.now();
        if (value.mediaType === 'tv') {
            value.season  = parseInt(value.season,  10) || 1;
            value.episode = parseInt(value.episode, 10) || 1;
        }
    }

    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx      = db.transaction(STORE_NAME, 'readwrite');
            const store   = tx.objectStore(STORE_NAME);
            const request = store.put(value, key);
            request.onsuccess = () => resolve();
            request.onerror   = () => reject(request.error);
        });

        if (!skipBroadcast && key.startsWith('vailism_')) {
            try {
                const bc = new BroadcastChannel('vailism_sync');
                bc.postMessage({ type: 'UPDATE', key });
                bc.close();
            } catch (e) {}
        }
    } catch (e) {
        console.warn('[VAILISM] IDB lsSet failed:', e);
    }
}

export async function lsRemove(key, skipBroadcast = false) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx      = db.transaction(STORE_NAME, 'readwrite');
            const store   = tx.objectStore(STORE_NAME);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror   = () => reject(request.error);
        });

        if (!skipBroadcast && key.startsWith('vailism_')) {
            try {
                const bc = new BroadcastChannel('vailism_sync');
                bc.postMessage({ type: 'UPDATE', key });
                bc.close();
            } catch (e) {}
        }
    } catch (e) {
        console.warn('[VAILISM] IDB lsRemove failed:', e);
    }
}

export async function lsKeys() {
    try {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx      = db.transaction(STORE_NAME, 'readonly');
            const store   = tx.objectStore(STORE_NAME);
            const request = store.getAllKeys();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror   = () => reject(request.error);
        });
    } catch (e) { return []; }
}

// ── Progress key builder ───────────────────────────────────────────────────────
export function getProgressKey(movieId, mediaType, season, episode) {
    if (mediaType === 'tv') {
        const s = season  !== undefined ? season  : 1;
        const e = episode !== undefined ? episode : 1;
        return 'vailism_progress_' + movieId + '_s' + s + '_e' + e;
    }
    return 'vailism_progress_' + movieId;
}

// ── Progress validation ────────────────────────────────────────────────────────
export function isValidProgress(data) {
    if (!data || typeof data !== 'object') return false;
    const id        = parseInt(data.id !== undefined ? data.id : data.tmdbId, 10);
    const mediaType = data.mediaType;
    const ts        = parseFloat(data.timestamp  !== undefined ? data.timestamp  : data.currentTime);
    const dur       = parseFloat(data.duration);
    if (isNaN(id) || !mediaType || (mediaType !== 'movie' && mediaType !== 'tv')) return false;
    if (isNaN(ts) || isNaN(dur) || dur <= 0) return false;
    return true;
}

// ── One-time migration: localStorage → IDB ────────────────────────────────────
export async function migrateFromLocalStorage() {
    try {
        if (localStorage.getItem('vailism_idb_migrated')) return;
        const keys = Object.keys(localStorage);
        for (const key of keys) {
            if (key.startsWith('vailism_')) {
                try {
                    let value = localStorage.getItem(key);
                    try { value = JSON.parse(value); } catch (e) {}
                    await lsSet(key, value, true);
                } catch (e) {}
            }
        }
        localStorage.setItem('vailism_idb_migrated', 'true');
        console.log('[VAILISM] Storage migrated to IndexedDB.');
    } catch (e) {}
}

// ── Latest progress for a TV show (most recently watched episode) ──────────────
export async function getLatestProgressForShow(showId) {
    const keys         = await lsKeys();
    const progressKeys = [];
    for (const k of keys) {
        if (k.startsWith('vailism_progress_' + showId)) {
            const data = await lsGet(k);
            if (data && data.updatedAt) progressKeys.push({ key: k, data });
        }
    }
    progressKeys.sort((a, b) => b.data.updatedAt - a.data.updatedAt);
    return progressKeys.length > 0 ? progressKeys[0].data : null;
}

// ── Auto-cleanup: remove stale / invalid progress entries ──────────────────────
export async function autoCleanup() {
    const keys         = await lsKeys();
    const progressKeys = keys.filter(k => k.startsWith('vailism_progress_'));
    const now          = Date.now();
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
