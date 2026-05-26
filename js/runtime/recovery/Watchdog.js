export class Watchdog {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.watchdogInterval = null;
        this.lastLocalTime = 0;
        this.lastTimeProgression = Date.now();
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.lastLocalTime = 0;
        this.lastTimeProgression = Date.now();

        this.eventBus.on("LOCAL_PLAYER_TIME_UPDATE", (data) => {
            if (data.currentTime !== this.lastLocalTime) {
                this.lastLocalTime = data.currentTime;
                this.lastTimeProgression = Date.now();
                this.eventBus.emit("WATCHDOG_PLAYHEAD_PROGRESS", { currentTime: data.currentTime });
            }
        });

        this.eventBus.on("FSM_TRANSITION", (data) => {
            if (data.currentState === "PLAYING") {
                this.lastTimeProgression = Date.now();
            }
        });

        // Watchdog playhead progression monitor running every 1 second
        this.watchdogInterval = setInterval(() => {
            try {
                if (document.visibilityState === 'hidden') return;
                const syncEngine = this.kernel.get("sync");
                if (!syncEngine || !syncEngine.isPlaying || syncEngine.isJoinBuffered) return;

                syncEngine.getPlayerTime().then(currentTime => {
                    if (currentTime === this.lastLocalTime) {
                        const timeSinceProgress = Date.now() - this.lastTimeProgression;
                        if (timeSinceProgress > 4000) {
                            console.warn(`[Watchdog] Playhead frozen for ${Math.round(timeSinceProgress / 1000)}s.`);
                            this.eventBus.emit("WATCHDOG_STALL_DETECTED", {
                                currentTime,
                                duration: timeSinceProgress
                            });
                        }
                    } else {
                        this.lastLocalTime = currentTime;
                        this.lastTimeProgression = Date.now();
                    }
                });
            } catch (e) {
                console.error("[Watchdog] Error in stalled playhead checker loop:", e);
            }
        }, 1000);
    }

    onStop() {
        if (this.watchdogInterval) {
            clearInterval(this.watchdogInterval);
            this.watchdogInterval = null;
        }
    }
}
