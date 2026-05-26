export class DriftController {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.maxDriftSeconds = 1.5;
        this.hardSeekTimestamps = [];
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.maxDriftSeconds = 1.5;
        this.hardSeekTimestamps = [];

        this.eventBus.on("SYNC_CONFIDENCE_CHANGED", (data) => {
            if (data.confidence === "unstable") {
                this.maxDriftSeconds = 5.0;
            } else {
                this.maxDriftSeconds = 1.5;
            }
        });
    }

    onStop() {
        this.hardSeekTimestamps = [];
    }

    calculateDrift(localSeconds, targetSeconds) {
        return localSeconds - targetSeconds;
    }

    adjustPlayback(localSeconds, targetSeconds, adapter, isPlaying) {
        const difference = this.calculateDrift(localSeconds, targetSeconds);
        const absDiff = Math.abs(difference);

        if (absDiff > this.maxDriftSeconds) {
            console.log(`[DriftController] Hard drift exceeded limit (${absDiff.toFixed(2)}s). Seeking to ${targetSeconds.toFixed(1)}s`);
                console.log(`[VAILISM SYNC] Applying SEEK`, { targetTime: targetSeconds, difference });
            
            this.recordHardSeek(difference);

            adapter.seek(targetSeconds);
            adapter.setPlaybackRate(1.0);
            
            this.eventBus.emit("DRIFT_SEEK_EXECUTED", { targetTime: targetSeconds, difference });
            return "stabilizing";
        } else if (absDiff > 0.25) {
            const rate = difference > 0 ? 0.97 : 1.03;
            adapter.setPlaybackRate(rate);
            
            this.eventBus.emit("DRIFT_RATE_ADJUSTED", { rate, difference });
            return "stabilizing";
        } else {
            adapter.setPlaybackRate(1.0);
            return "synced";
        }
    }

    recordHardSeek(difference) {
        this.hardSeekTimestamps.push(Date.now());
        this.hardSeekTimestamps = this.hardSeekTimestamps.filter(t => Date.now() - t < 30000);
        
        this.eventBus.emit("DRIFT_CORRECTED", difference);
        
        if (this.hardSeekTimestamps.length >= 3) {
            this.eventBus.emit("DRIFT_LOOP_DETECTED", { hardSeeksCount: this.hardSeekTimestamps.length });
        }
    }

    getLastHardSeekAge() {
        if (this.hardSeekTimestamps.length === 0) return 30000;
        return Date.now() - this.hardSeekTimestamps[this.hardSeekTimestamps.length - 1];
    }
}
