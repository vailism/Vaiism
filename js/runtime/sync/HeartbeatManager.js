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
        
        this.eventBus.on("REMOTE_SYNC_RECEIVED", (payload) => {
            console.log('[VAILISM HEARTBEAT] Received host heartbeat', payload);
            this.lastHeartbeatTime = Date.now();
        });

        this.eventBus.on("VISIBILITY_CHANGED", (data) => {
            const socket = this.kernel.get("socket");
            if (socket && socket.isHost && this.heartbeatInterval) {
                const syncEngine = this.kernel.get("sync");
                if (data.state === 'hidden') {
                    this.startSending(syncEngine, 5000);
                } else {
                    this.startSending(syncEngine, 2500);
                }
            }
        });
    }

    onStop() {
        this.stopSending();
    }

    startSending(syncEngine, intervalMs = 2500) {
        this.stopSending();
        this.heartbeatInterval = setInterval(() => {
            try {
                const socket = this.kernel.get("socket");
                // Only active host triggers sync heartbeats
                if (!socket || !socket.isConnected() || !socket.isHost) return;

                syncEngine.getSyncSnapshot().then(snapshot => {
                    socket.emitSyncEvent({
                        currentTime: snapshot.currentTime,
                        playing: !!snapshot.playing,
                        paused: !!snapshot.paused,
                        buffering: !!snapshot.buffering,
                        playbackRate: Number.isFinite(snapshot.playbackRate) ? snapshot.playbackRate : 1.0,
                        duration: Number.isFinite(snapshot.duration) ? snapshot.duration : 0,
                        telemetrySource: snapshot.source || 'heartbeat-snapshot',
                        synthetic: !!snapshot.synthetic,
                        ts: Date.now()
                    });
                    this.eventBus.emit("HEARTBEAT_SENT", {
                        currentTime: snapshot.currentTime,
                        source: snapshot.source || 'heartbeat-snapshot',
                        synthetic: !!snapshot.synthetic
                    });
                    console.log('[VAILISM HEARTBEAT] Sent periodic heartbeat snapshot', {
                        currentTime: snapshot.currentTime,
                        source: snapshot.source || 'heartbeat-snapshot',
                        synthetic: !!snapshot.synthetic
                    });
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
