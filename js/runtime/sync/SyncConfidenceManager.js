export class SyncConfidenceManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.syncConfidence = "synced";
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.syncConfidence = "synced";

        this.eventBus.on("DRIFT_LOOP_DETECTED", () => {
            this.setConfidence("unstable");
        });

        this.eventBus.on("SOCKET_DISCONNECTED", () => {
            this.setConfidence("recovering");
        });

        this.eventBus.on("SOCKET_CONNECTED", () => {
            this.setConfidence("stabilizing");
        });
    }

    onStop() {
        this.syncConfidence = "synced";
    }

    setConfidence(level) {
        if (this.syncConfidence === level) return;
        const oldLevel = this.syncConfidence;
        this.syncConfidence = level;
        console.log(`[SyncConfidence] State: ${oldLevel} -> ${level}`);
        
        if (this.eventBus) {
            this.eventBus.emit("SYNC_CONFIDENCE_CHANGED", { confidence: level });
        }
    }

    getConfidence() {
        return this.syncConfidence;
    }
}
