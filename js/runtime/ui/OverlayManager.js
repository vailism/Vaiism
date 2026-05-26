export class OverlayManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.eventBus.on("JOIN_BUFFER_START", (data) => this.showJoinOverlay(data.statusText));
        this.eventBus.on("JOIN_BUFFER_PROGRESS", (data) => this.showJoinOverlay(data.statusText));
        
        this.eventBus.on("JOIN_BUFFER_COMPLETE", () => {
            this.showJoinOverlay("Ready");
            setTimeout(() => this.hideJoinOverlay(), 500);
        });

        this.eventBus.on("RECOVERY_RELOAD_STARTING", (data) => {
            this.showJoinOverlay(`Recovering stream (Attempt #${data.attempt})...`);
        });

        this.eventBus.on("RECOVERY_RELOAD_COMPLETED", () => {
            this.showJoinOverlay("Ready");
            setTimeout(() => this.hideJoinOverlay(), 500);
        });

        this.eventBus.on("RECOVERY_EXHAUSTED", () => {
            this.showBlockedAutoplayUI();
        });
    }

    onStop() {
        this.hideJoinOverlay();
        this.hideBlockedAutoplayUI();
    }

    showJoinOverlay(statusText) {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.overlay", "showJoinOverlay", () => {
            const overlay = document.getElementById("partyJoinOverlay");
            const textEl = document.getElementById("partyJoinStatusText");
            if (overlay && textEl) {
                textEl.textContent = statusText;
                overlay.style.display = "flex";
                overlay.style.opacity = "1";
            }
        });
    }

    hideJoinOverlay() {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.overlay", "hideJoinOverlay", () => {
            const overlay = document.getElementById("partyJoinOverlay");
            if (overlay) {
                overlay.style.opacity = "0";
                setTimeout(() => {
                    try {
                        overlay.style.display = "none";
                    } catch (e) {}
                }, 400);
            }
        });
    }

    showBlockedAutoplayUI() {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.overlay", "showBlockedAutoplayUI", () => {
            const overlay = document.getElementById("partyAutoplayBlockOverlay");
            if (overlay) {
                overlay.style.display = "flex";
                const btn = document.getElementById("partyUnblockAutoplayBtn");
                if (btn) {
                    btn.onclick = () => {
                        this.unblockAutoplay();
                    };
                }
            }
        });
    }

    hideBlockedAutoplayUI() {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.overlay", "hideBlockedAutoplayUI", () => {
            const overlay = document.getElementById("partyAutoplayBlockOverlay");
            if (overlay) {
                overlay.style.display = "none";
            }
        });
    }

    unblockAutoplay() {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.overlay", "unblockAutoplay", () => {
            console.log("[OverlayManager] User clicked unblock button. Resuming stream...");
            const syncEngine = this.kernel.get("sync");
            const heartbeats = this.kernel.get("sync.heartbeats");
            const snapshots = this.kernel.get("sync.snapshots");
            
            const adapter = syncEngine.getAdapter();
            if (adapter) {
                adapter.play();
                const snapshot = snapshots.getSnapshot();
                if (snapshot && heartbeats.lastHeartbeatTime) {
                    const elapsed = (Date.now() - heartbeats.lastHeartbeatTime) / 1000;
                    const hostTime = snapshot.currentTime + (snapshot.playing ? elapsed : 0);
                    adapter.seek(hostTime);
                }
            }

            syncEngine.isPlaying = true;
            const recovery = this.kernel.get("recovery");
            if (recovery) {
                recovery.retryCount = 0;
            }
            syncEngine.lastTimeProgression = Date.now();
            this.hideBlockedAutoplayUI();
        });
    }
}
