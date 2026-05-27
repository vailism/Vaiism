import { CloudSyncManager } from './cloud-sync.js';

class WatchlistManagerImpl {
    constructor() {}

    getWatchlist() {
        const raw = localStorage.getItem('vailism_watchlist');
        if (raw) {
            const data = JSON.parse(raw);
            return Array.isArray(data.items) ? data.items : [];
        }
        return [];
    }

    isInWatchlist(tmdbId) {
        const list = this.getWatchlist();
        return list.some(item => String(item.tmdbId) === String(tmdbId));
    }

    async toggleWatchlist(item) {
        let list = this.getWatchlist();
        const exists = list.some(i => String(i.tmdbId) === String(item.tmdbId));

        if (exists) {
            // Remove
            list = list.filter(i => String(i.tmdbId) !== String(item.tmdbId));
            this.saveLocal(list);
            await CloudSyncManager.syncWatchlistItem(item, true); // true = isRemove
            return false; // Removed
        } else {
            // Add
            item.addedAt = Date.now();
            list.unshift(item);
            this.saveLocal(list);
            await CloudSyncManager.syncWatchlistItem(item, false);
            return true; // Added
        }
    }

    saveLocal(items) {
        localStorage.setItem('vailism_watchlist', JSON.stringify({ items, updated: Date.now() }));
    }
}

export const WatchlistManager = new WatchlistManagerImpl();
