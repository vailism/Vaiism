/**
 * @file PreloadManager.js
 * @description Listens to timeline mouse movements to trigger predictive preload events inside the player.
 */
export class PreloadManager {
    /**
     * @param {HTMLElement} timelineElement Playback timeline seekbar DOM node
     * @param {SyncManager} syncManager Reference to SyncManager instance
     */
    constructor(timelineElement, syncManager) {
        this.timeline = timelineElement;
        this.sync = syncManager;
        this.gc = syncManager.room.gc;
        this.lastPreloadTime = 0;
        
        this._setupPreloadTriggers();
    }

    _setupPreloadTriggers() {
        if (!this.timeline) return;

        const handleHover = (e) => this._onTimelineHover(e);
        this.gc.addListener(this.timeline, "mousemove", handleHover);
    }

    /**
     * Computes timeline position and tells player iframe to pre-fetch fragments.
     */
    _onTimelineHover(event) {
        const now = Date.now();
        // Throttle preloads to once every 1000ms to avoid CDN manifest congestion
        if (now - this.lastPreloadTime < 1000) return;

        const rect = this.timeline.getBoundingClientRect();
        if (rect.width === 0) return;

        const clickX = event.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, clickX / rect.width));
        
        this.sync.getPlayerDuration().then(duration => {
            if (duration <= 0) return;

            const targetPreloadTime = percentage * duration;
            this.lastPreloadTime = now;

            // postMessage command to player frame for preloading
            this.sync.sendToPlayer({
                command: "preload",
                time: targetPreloadTime
            });
        });
    }

    destroy() {
        this.timeline = null;
        this.sync = null;
        this.gc = null;
    }
}
