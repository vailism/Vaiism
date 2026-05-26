export class HeartbeatManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.heartbeatInterval = null;
        this.lastHeartbeatTime = Date.now();
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.lastHeartbeatTime = Date.now();
        
        this.eventBus.on("REMOTE_SYNC_RECEIVED", () => {
            this.lastHeartbeatTime = Date.now();
        });

        this.eventBus.on("VISIBILITY_CHANGED", (data) => {
            const socket = this.kernel.get("socket");
            if (socket && socket.isHost && this.heartbeatInterval) {
                const syncEngine = this.kernel.get("sync");
                if (data.state === 'hidden') {
                    this.startSending(syncEngine, 15000);
                } else {
                    this.startSending(syncEngine, 5000);
                }
            }
        });
    }

    onStop() {
        this.stopSending();
    }

    startSending(syncEngine, intervalMs = 5000) {
        this.stopSending();
        this.heartbeatInterval = setInterval(() => {
            try {
                const socket = this.kernel.get("socket");
                // Only active host triggers sync heartbeats
                if (!socket || !socket.isConnected() || !socket.isHost) return;

                syncEngine.getPlayerTime().then(currentTime => {
                    if (currentTime > 0) {
                        socket.emitSyncEvent({
                            currentTime: currentTime,
                            playing: syncEngine.isPlaying,
                            buffering: false,
                            playbackRate: 1.0,
                            ts: Date.now()
                        });
                        this.eventBus.emit("HEARTBEAT_SENT", { currentTime });
                    }
                });
            } catch (e) {
                console.error("[HeartbeatManager] Error in heartbeat transmit loop:", e);
            }
        }, intervalMs);
    }

    stopSending() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    checkStaleAge(limitMs = 15000) {
        const socket = this.kernel.get("socket");
        if (!socket || !socket.isConnected() || socket.isHost) return false;
        
        const age = Date.now() - this.lastHeartbeatTime;
        if (age > limitMs) {
            this.eventBus.emit("HEARTBEAT_STALE", { age });
            return true;
        }
        return false;
    }
}
