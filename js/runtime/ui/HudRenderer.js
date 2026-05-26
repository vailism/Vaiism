export class HudRenderer {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.debugHudInterval = null;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        const isDebug = new URLSearchParams(window.location.search).get('debug') === 'true' || 
                        window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1';
        
        const hud = document.getElementById("partyDebugOverlay");
        if (!hud) return;

        if (!isDebug) {
            hud.style.display = "none";
            return;
        }

        hud.style.display = "block";

        if (this.debugHudInterval) clearInterval(this.debugHudInterval);
        this.debugHudInterval = setInterval(() => {
            if (document.visibilityState === 'hidden') return;
            const failureIsolation = this.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.hud", "renderHud", () => {
                const socket = this.kernel.get("socket");
                if (!socket || !socket.isConnected()) {
                    hud.innerHTML = "HUD Status: Offline";
                    return;
                }

                const syncEngine = this.kernel.get("sync");
                const fsm = this.kernel.get("fsm");
                const metricsStore = this.kernel.get("metrics");
                const heartbeats = this.kernel.get("sync.heartbeats");
                const confidenceManager = this.kernel.get("sync.confidence");

                syncEngine.getPlayerTime().then(localTime => {
                    let hostTime = localTime;
                    let drift = 0;

                    if (!socket.isHost && heartbeats.lastHeartbeatTime > 0) {
                        const elapsed = (Date.now() - heartbeats.lastHeartbeatTime) / 1000;
                        hostTime = syncEngine.lastHostTime + (syncEngine.lastHostPlaying ? elapsed : 0);
                        drift = localTime - hostTime;
                    }

                    const statusText = socket.isConnected() ? "CONNECTED" : "DISCONNECTED";
                    const age = heartbeats.lastHeartbeatTime > 0 ? ((Date.now() - heartbeats.lastHeartbeatTime) / 1000).toFixed(1) + "s" : "N/A";
                    const vis = document.visibilityState || "visible";
                    const adapter = syncEngine.getAdapter();
                    const adapterType = adapter ? adapter.constructor.name : "None";
                    const confidence = confidenceManager.getConfidence().toUpperCase();
                    const fsmState = fsm ? fsm.currentState : "UNKNOWN";

                    const metrics = metricsStore.metrics;
                    const avgDrift = metricsStore.getAverageDrift().toFixed(3) + "s";
                    const avgRtt = metricsStore.getAverageRtt(socket.rtt) + "ms";
                    
                    hud.innerHTML = `
                        <strong>Watch Together Debug HUD</strong><br>
                        Status: <span style="color: ${socket.isConnected() ? '#00ff66' : '#ff4444'}">${statusText}</span><br>
                        FSM State: <span style="color: #00e5ff">${fsmState}</span><br>
                        Confidence: <span style="color: #f5a623">${confidence}</span><br>
                        Role: ${socket.isHost ? "HOST" : "GUEST"}<br>
                        Adapter: ${adapterType}<br>
                        RTT: ${socket.rtt || 0}ms (Avg: ${avgRtt})<br>
                        Heartbeat Age: ${age}<br>
                        Tab Visibility: ${vis}<br>
                        Local Playhead: ${localTime.toFixed(2)}s<br>
                        Host Playhead: ${hostTime.toFixed(2)}s<br>
                        Drift: <span style="color: ${Math.abs(drift) > syncEngine.maxDriftSeconds ? '#ff4444' : '#00ff66'}">${drift.toFixed(3)}s</span> (Avg: ${avgDrift})<br>
                        Max Allowed Drift: ${syncEngine.maxDriftSeconds}s<br>
                        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0;">
                        <strong>Metrics:</strong><br>
                        Hard Seeks: ${metrics.hardSeeksCount}<br>
                        Stalls: ${metrics.stallsCount}<br>
                        Recovery Seeks: ${metrics.recoveryAttempts}<br>
                        Iframe Reloads: ${metrics.providerReloads}<br>
                        Socket Reconnects: ${metrics.reconnectCount}<br>
                        Heartbeat Misses: ${metrics.heartbeatMisses}
                    `;
                });
            });
        }, 200);
    }

    onStop() {
        if (this.debugHudInterval) {
            clearInterval(this.debugHudInterval);
            this.debugHudInterval = null;
        }
    }
}
