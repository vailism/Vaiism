export class DriftController {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.maxDriftSeconds = 1.5;
        this.hardSeekTimestamps = [];
        this.softConvergenceWindowSeconds = 15;
        this.hardSeekWindowSeconds = 15;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.maxDriftSeconds = 1.5;
        this.hardSeekTimestamps = [];
        this.softConvergenceWindowSeconds = 15;
        this.hardSeekWindowSeconds = 15;

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
        const syncEngine = this.kernel.get("sync");
        if (!syncEngine || !adapter) return "blocked";

        syncEngine.unfreezeSyncIfReady();

        const adapterState = typeof adapter.getStateSnapshot === 'function' ? adapter.getStateSnapshot() : null;
        const providerStability = typeof syncEngine.getProviderStabilityStatus === 'function'
            ? syncEngine.getProviderStabilityStatus()
            : null;

        if (syncEngine.shouldAbortSync && syncEngine.shouldAbortSync()) {
            this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "sync-frozen" });
            return "frozen";
        }

        if (!adapter.iframe || !adapter.iframe.contentWindow) {
            this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "iframe-not-ready" });
            return "blocked";
        }

        const difference = this.calculateDrift(localSeconds, targetSeconds);
        const absDiff = Math.abs(difference);
        const buffering = !!(adapterState && adapterState.buffering);
        const stalled = !!(adapterState && adapterState.paused && isPlaying);
        const cooldownActive = typeof syncEngine.isSeekCooldownActive === 'function' && syncEngine.isSeekCooldownActive();
        
        if (buffering) {
            if (typeof syncEngine.noteProviderBufferingStart === 'function') {
                syncEngine.noteProviderBufferingStart();
            }
            if (typeof syncEngine.isBufferingBlocked === 'function' && syncEngine.isBufferingBlocked()) {
                syncEngine.freezeSync('buffering>8s');
                this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "buffering-freeze", difference });
                return "frozen";
            }
            this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "buffering-active", difference });
            return "frozen";
        }

        if (typeof syncEngine.noteProviderBufferingEnd === 'function') {
            syncEngine.noteProviderBufferingEnd();
        }

        if (stalled) {
            this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "playback-stalled", difference });
            return "blocked";
        }

        // --- SAFE_SYNC_MODE ---
        const SAFE_SYNC_MODE = true;
        if (SAFE_SYNC_MODE) {
            // Restore normal playback rate, no rate manipulation allowed
            this.restoreNormalPlaybackRate(adapter, syncEngine);
            
            // Only seek if drift > 20s
            if (absDiff > 20) {
                if (cooldownActive) {
                    this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "seek-cooldown", difference });
                    return "cooldown";
                }
                console.log(`[DriftController] [SAFE_SYNC_MODE] Drift exceeded 20s (${absDiff.toFixed(2)}s). Seeking to ${targetSeconds.toFixed(1)}s`);
                this.recordHardSeek(difference);
                if (typeof syncEngine.noteHardSeekIssued === 'function') {
                    syncEngine.noteHardSeekIssued(targetSeconds, difference);
                }
                adapter.seek(targetSeconds);
                this.eventBus.emit("DRIFT_SEEK_EXECUTED", { targetTime: targetSeconds, difference, mode: 'safe' });
                return "seeking";
            }
            
            return "synced";
        }

        const aggressiveAllowed = !!(syncEngine.providerSyncMode === 'precise' && !syncEngine.aggressiveSeekingDisabled);

        if (cooldownActive) {
            if (absDiff >= 2 && absDiff <= 15) {
                return this.applySoftConvergence(localSeconds, targetSeconds, adapter, difference, syncEngine);
            }
            if (absDiff <= 2) {
                this.restoreNormalPlaybackRate(adapter, syncEngine);
                return "synced";
            }
            this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "seek-cooldown", difference });
            return "cooldown";
        }

        if (absDiff > this.hardSeekWindowSeconds) {
            if (aggressiveAllowed && typeof syncEngine.canPerformHardSeek === 'function' && syncEngine.canPerformHardSeek(adapter, difference)) {
                console.log(`[DriftController] Hard drift exceeded safe window (${absDiff.toFixed(2)}s). Seeking to ${targetSeconds.toFixed(1)}s`);
                console.log(`[VAILISM RECONCILE] Applying hard seek`, { targetTime: targetSeconds, difference });

                this.recordHardSeek(difference);
                syncEngine.noteHardSeekIssued(targetSeconds, difference);
                adapter.seek(targetSeconds);
                if (typeof adapter.setPlaybackRate === 'function') {
                    adapter.setPlaybackRate(1.0);
                }

                this.eventBus.emit("DRIFT_SEEK_EXECUTED", { targetTime: targetSeconds, difference, mode: 'precise' });
                return "seeking";
            }

            return this.applySoftConvergence(localSeconds, targetSeconds, adapter, difference, syncEngine, true);
        }

        if (absDiff >= 2) {
            return this.applySoftConvergence(localSeconds, targetSeconds, adapter, difference, syncEngine);
        }

        this.restoreNormalPlaybackRate(adapter, syncEngine);
        this.eventBus.emit("DRIFT_RATE_ADJUSTED", { rate: 1.0, difference });
        return "synced";
    }

    applySoftConvergence(localSeconds, targetSeconds, adapter, difference, syncEngine, forceSoft = false) {
        const absDiff = Math.abs(difference);
        if (!adapter || typeof adapter.setPlaybackRate !== 'function') {
            return "blocked";
        }

        const providerSupportsRate = !syncEngine.providerCapabilities || syncEngine.providerCapabilities.supportsPlaybackRate !== false;
        if (!providerSupportsRate) {
            this.eventBus.emit("SYNC_CORRECTION_ABORTED", { reason: "rate-control-unsupported", difference });
            return "blocked";
        }

        if (absDiff <= 2 && !forceSoft) {
            this.restoreNormalPlaybackRate(adapter, syncEngine);
            return "synced";
        }

        const rate = difference > 0 ? 0.95 : 1.05;
        console.log('[VAILISM RECONCILE] Soft convergence', {
            localTime: localSeconds,
            hostTime: targetSeconds,
            calculatedDrift: difference,
            playbackRate: rate,
            absDiff
        });

        adapter.setPlaybackRate(rate);
        syncEngine.softConvergenceActive = true;
        if (typeof syncEngine.noteSuccessfulConvergence === 'function') {
            syncEngine.noteSuccessfulConvergence('soft', { targetTime: targetSeconds, difference, rate });
        }

        this.eventBus.emit("DRIFT_RATE_ADJUSTED", { rate, difference, mode: 'safe-soft' });

        if (absDiff <= 15) {
            setTimeout(() => {
                this.restoreNormalPlaybackRate(adapter, syncEngine);
            }, 1200);
        }

        return "stabilizing";
    }

    restoreNormalPlaybackRate(adapter, syncEngine) {
        if (!adapter || typeof adapter.setPlaybackRate !== 'function') return;
        adapter.setPlaybackRate(1.0);
        if (syncEngine) {
            syncEngine.softConvergenceActive = false;
        }
        const providerStability = syncEngine && typeof syncEngine.getProviderStabilityStatus === 'function'
            ? syncEngine.getProviderStabilityStatus()
            : null;
        this.eventBus.emit("DRIFT_RATE_ADJUSTED", { rate: 1.0, difference: 0, mode: 'restore' });
        this.eventBus.emit("CONVERGENCE_COMPLETED", {
            provider: syncEngine && typeof syncEngine.getProviderName === 'function' ? syncEngine.getProviderName() : 'unknown',
            stability: providerStability ? providerStability.score : undefined
        });
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
