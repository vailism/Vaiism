import { CloudSyncManager } from './cloud-sync.js';

class WatchProgressManagerImpl {
    constructor() {
        this.saveTimeout = null;
        this.lastSavedTime = 0;
    }

    saveProgress(contentId, details, currentTime, duration, isPaused = false, isExit = false) {
        if (!contentId || !duration) return;

        const progressPercent = (currentTime / duration) * 100;
        
        // Ignore progress below 2%
        if (progressPercent < 2 && !isExit) return;

        const progressData = {
            ...details,
            currentTime,
            duration,
            progressPercent: progressPercent > 90 ? 100 : progressPercent,
            completed: progressPercent > 90,
            updatedAt: Date.now()
        };

        // Update Local Storage
        localStorage.setItem(`vailism_progress_${contentId}`, JSON.stringify(progressData));

        // Debounce cloud sync (Save every 60s or immediately on pause/exit)
        if (isPaused || isExit) {
            this.forceSync(contentId, progressData);
        } else {
            if (Math.abs(currentTime - this.lastSavedTime) >= 60 || this.lastSavedTime === 0) {
                this.forceSync(contentId, progressData);
                this.lastSavedTime = currentTime;
            } else {
                clearTimeout(this.saveTimeout);
                this.saveTimeout = setTimeout(() => {
                    this.forceSync(contentId, progressData);
                    this.lastSavedTime = currentTime;
                }, 2000);
            }
        }
    }

    forceSync(contentId, progressData) {
        clearTimeout(this.saveTimeout);
        CloudSyncManager.syncProgress({ contentId, ...progressData });
    }

    getProgress(contentId) {
        const data = localStorage.getItem(`vailism_progress_${contentId}`);
        return data ? JSON.parse(data) : null;
    }

    getAllProgress() {
        const progressItems = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('vailism_progress_')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    if (data) progressItems.push({ key, data });
                } catch(e) {}
            }
        }
        return progressItems;
    }
}

export const WatchProgressManager = new WatchProgressManagerImpl();
