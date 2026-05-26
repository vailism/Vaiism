export class SnapshotManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.lastSnapshot = null;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.lastSnapshot = null;
        
        // Cache remote sync state changes
        this.eventBus.on("REMOTE_SYNC_RECEIVED", (payload) => {
            this.lastSnapshot = payload;
            this.eventBus.emit("SNAPSHOT_UPDATED", this.lastSnapshot);
        });

        // Cache host broadcast commands
        this.eventBus.on("LOCAL_SYNC_BROADCASTED", (payload) => {
            this.lastSnapshot = payload;
            this.eventBus.emit("SNAPSHOT_UPDATED", this.lastSnapshot);
        });
    }

    onStop() {
        this.lastSnapshot = null;
    }

    getSnapshot() {
        return this.lastSnapshot;
    }

    restore(adapter) {
        if (!this.lastSnapshot || !adapter) return false;
        
        const { action, currentTime, playing, ts } = this.lastSnapshot;
        const elapsed = (Date.now() - ts) / 1000;
        const targetTime = currentTime + (playing ? elapsed : 0);

        console.log(`[SnapshotManager] Restoring state from cached snapshot: seek to ${targetTime.toFixed(1)}s, playing=${playing}`);
        
        adapter.seek(targetTime);
        if (playing) {
            adapter.play();
        } else {
            adapter.pause();
        }
        
        this.eventBus.emit("SNAPSHOT_RESTORED", { targetTime, playing });
        return true;
    }
}
