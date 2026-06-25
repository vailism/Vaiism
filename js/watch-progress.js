import { lsSet, lsGet, lsKeys, isValidProgress } from './storage.js';
import { CloudSyncManager } from './cloud-sync.js';

class WatchProgressManagerImpl {
    constructor() {
        this.saveTimeout   = null;
        this.lastSavedTime = 0;
    }

    /**
     * Save watch progress to IndexedDB (single source of truth).
     * Debounced: writes immediately on pause/exit, otherwise every 60 s of play.
     */
    saveProgress(contentId, details, currentTime, duration, isPaused = false, isExit = false) {
        if (!contentId || !duration) return;

        const progressPercent = (currentTime / duration) * 100;

        // Ignore progress below 2 % (accidental clicks, pre-roll ads)
        if (progressPercent < 2 && !isExit) return;

        const progressData = {
            ...details,
            currentTime,
            duration,
            progressPercent : progressPercent > 90 ? 100 : progressPercent,
            completed       : progressPercent > 90,
            updatedAt       : Date.now()
        };

        // Write to IDB (primary store — replaces localStorage)
        const key = `vailism_progress_${contentId}`;
        lsSet(key, progressData);

        // Debounce cloud sync (save every 60 s or immediately on pause/exit)
        if (isPaused || isExit) {
            this._forceSync(contentId, progressData);
        } else {
            if (Math.abs(currentTime - this.lastSavedTime) >= 60 || this.lastSavedTime === 0) {
                this._forceSync(contentId, progressData);
                this.lastSavedTime = currentTime;
            } else {
                clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => {
                    this._forceSync(contentId, progressData);
                    this.lastSavedTime = currentTime;
                }, 2000);
            }
        }
    }

    _forceSync(contentId, progressData) {
        clearTimeout(this.saveTimeout);
        CloudSyncManager.syncProgress({ contentId, ...progressData });
    }

    /** Async: reads a single progress entry from IDB. */
    async getProgress(contentId) {
        return lsGet(`vailism_progress_${contentId}`);
    }

    /**
     * Returns all progress entries from IDB as { key, data }[] objects.
     * This is async because IDB reads are async. The caller (loadContinueWatching)
     * awaits the result.
     */
    async getAllProgress() {
        const allKeys      = await lsKeys();
        const progressKeys = allKeys.filter(k => k.startsWith('vailism_progress_'));
        const results      = [];
        for (const key of progressKeys) {
            const data = await lsGet(key);
            if (data && isValidProgress(data)) {
                results.push({ key, data });
            }
        }
        return results;
    }
}

export const WatchProgressManager = new WatchProgressManagerImpl();
