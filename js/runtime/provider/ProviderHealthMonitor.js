export class ProviderHealthMonitor {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.lastMessageTime = Date.now();
        this.checkInterval = null;
        this.isPlaying = false;
        this.lastTime = 0;
        this.lastProgressTime = Date.now();
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.lastMessageTime = Date.now();
        this.lastProgressTime = Date.now();
        this.lastTime = 0;

        // Monitor message activity
        this.eventBus.on("PLAYER_MESSAGE_RECEIVED", () => {
            this.lastMessageTime = Date.now();
        });

        this.eventBus.on("FSM_TRANSITION", (data) => {
            this.isPlaying = (data.currentState === "PLAYING");
            if (!this.isPlaying) {
                // Reset progress timers when paused/buffering to avoid false positive stalls
                this.lastProgressTime = Date.now();
            }
        });

        this.eventBus.on("LOCAL_PLAYER_TIME_UPDATE", (data) => {
            this.lastMessageTime = Date.now();
            if (data.currentTime !== this.lastTime) {
                this.lastTime = data.currentTime;
                this.lastProgressTime = Date.now();
            }
        });

        // Run active health probe check loop every 3 seconds
        this.checkInterval = setInterval(() => {
            try {
                const now = Date.now();
                const messageAge = now - this.lastMessageTime;
                const progressAge = now - this.lastProgressTime;

                if (this.isPlaying) {
                    // Check for message silence (e.g. crashed contentWindow channel)
                    if (messageAge > 10000) {
                        console.warn(`[HealthMonitor] Detected postMessage silence of ${Math.round(messageAge / 1000)}s.`);
                        this.eventBus.emit("PROVIDER_HEALTH_DEGRADED", {
                            reason: "silence",
                            detail: `postMessage silence for ${Math.round(messageAge / 1000)}s`
                        });
                    }
                    // Check for frozen playback (e.g. decoder freeze)
                    else if (progressAge > 8000) {
                        console.warn(`[HealthMonitor] Detected frozen playhead of ${Math.round(progressAge / 1000)}s.`);
                        this.eventBus.emit("PROVIDER_HEALTH_DEGRADED", {
                            reason: "freeze",
                            detail: `Playhead frozen for ${Math.round(progressAge / 1000)}s`
                        });
                    }
                }
            } catch (e) {
                console.error("[HealthMonitor] Error in check interval:", e);
            }
        }, 3000);
    }

    onStop() {
        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }
    }
}
