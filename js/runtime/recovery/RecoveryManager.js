export class RecoveryManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.retryCount = 0;
        this.reloadAttempts = 0;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.retryCount = 0;
        this.reloadAttempts = 0;

        // Listen for watchdog playhead stall detections
        this.eventBus.on("WATCHDOG_STALL_DETECTED", (data) => {
            this.handleStallRecovery(data.currentTime);
        });

        // Listen for health monitor alerts
        this.eventBus.on("PROVIDER_HEALTH_DEGRADED", (data) => {
            if (data.reason === "freeze") {
                this.handleStallRecovery(data.currentTime || 0);
            } else if (data.reason === "silence" && this.reloadAttempts < 2) {
                this.triggerIframeReload();
            }
        });
    }

    onStop() {
        this.retryCount = 0;
        this.reloadAttempts = 0;
    }

    handleStallRecovery(currentTime) {
        const syncEngine = this.kernel.get("sync");
        const metrics = this.kernel.get("metrics");
        
        metrics.increment("stallsCount");

        const SAFE_SYNC_MODE = true;
        if (SAFE_SYNC_MODE) {
            console.log("[RecoveryManager] [SAFE_SYNC_MODE] Playback stalled. Skipping aggressive recovery seeks and reload loops to prevent interrupts.");
            // Freeze sync temporarily to let it buffer/stabilize
            if (typeof syncEngine.freezeSync === 'function') {
                syncEngine.freezeSync('stall-recovery');
            }
            this.eventBus.emit("SHOW_TOAST", { message: "Sync temporarily paused to stabilize playback..." });
            return;
        }

        if (this.retryCount < 3) {
            this.retryCount++;
            metrics.increment("recoveryAttempts");
            console.log(`[RecoveryManager] Playback stalled. Recovery seek retry #${this.retryCount}...`);
            
            const adapter = syncEngine.getAdapter();
            if (adapter) {
                adapter.seek(currentTime);
                adapter.play();
            }
        } else {
            // Seek retries exhausted. Reload iframe if reload cap not exceeded
            if (this.reloadAttempts < 2) {
                this.triggerIframeReload();
            } else {
                console.error("[RecoveryManager] Recovery and reload retries completely exhausted.");
                const fsm = this.kernel.get("fsm");
                fsm.transitionTo("FAILED", "Autoplay blocked or stream crashed permanently");
                this.eventBus.emit("RECOVERY_EXHAUSTED");
            }
        }
    }

    triggerIframeReload() {
        const SAFE_SYNC_MODE = true;
        if (SAFE_SYNC_MODE) {
            console.log("[RecoveryManager] [SAFE_SYNC_MODE] triggerIframeReload requested but disabled.");
            return;
        }

        const syncEngine = this.kernel.get("sync");
        const fsm = this.kernel.get("fsm");
        const metrics = this.kernel.get("metrics");

        this.reloadAttempts++;
        metrics.increment("providerReloads");
        fsm.transitionTo("RECOVERING", `RecoveryManager reloading iframe (Attempt #${this.reloadAttempts})`);

        const adapter = syncEngine.getAdapter();
        if (!adapter || !adapter.iframe) return;

        console.warn(`[RecoveryManager] Reloading iframe due to persistent stall. Reload attempt #${this.reloadAttempts}`);
        this.eventBus.emit("RECOVERY_RELOAD_STARTING", { attempt: this.reloadAttempts });

        const originalSrc = adapter.iframe.src;
        adapter.iframe.src = "about:blank";
        
        setTimeout(() => {
            try {
                adapter.iframe.src = originalSrc;
                
                // Re-trigger guest wait/join buffered flow
                syncEngine.isJoinBuffered = true;
                const snapshots = this.kernel.get("sync.snapshots");
                syncEngine.pendingHostPayload = snapshots.getSnapshot() || {
                    action: syncEngine.isPlaying ? "PLAY" : "PAUSE",
                    currentTime: syncEngine.lastLocalTime,
                    playing: syncEngine.isPlaying,
                    ts: Date.now()
                };
                
                this.retryCount = 0;
                syncEngine.lastTimeProgression = Date.now();
                this.eventBus.emit("RECOVERY_RELOAD_COMPLETED");
            } catch (err) {
                console.error("[RecoveryManager] Error resetting iframe source reload:", err);
            }
        }, 200);
    }
}
