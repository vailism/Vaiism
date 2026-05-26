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
                const syncEngine = this.kernel.get("sync");
                const fsm = this.kernel.get("fsm");
                const metricsStore = this.kernel.get("metrics");
                const heartbeats = this.kernel.get("sync.heartbeats");
                const confidenceManager = this.kernel.get("sync.confidence");
                const presence = this.kernel.get("network.presence");
                const reconnect = this.kernel.get("recovery.reconnect");

                if (!socket || !socket.isConnected()) {
                    hud.innerHTML = `
                        <strong>Watch Together Debug HUD</strong><br>
                        Socket: <span style="color:#ff4444">OFFLINE</span><br>
                        Room: ${reconnect && reconnect.roomId ? reconnect.roomId : 'N/A'}<br>
                        Host: ${presence && presence.hostId ? presence.hostId : 'N/A'}
                    `;
                    return;
                }

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
                    const roomId = reconnect && reconnect.roomId ? reconnect.roomId : "N/A";
                    const hostId = presence && presence.hostId ? presence.hostId : "N/A";
                    const lastPlaybackEvent = syncEngine.lastPlaybackEvent ? JSON.stringify(syncEngine.lastPlaybackEvent) : 'None';
                    const lastProviderCommand = syncEngine.lastProviderCommand ? JSON.stringify(syncEngine.lastProviderCommand) : 'None';
                    const lastSyncAge = syncEngine.lastSyncTimestamp ? ((Date.now() - syncEngine.lastSyncTimestamp) / 1000).toFixed(1) + "s" : "N/A";
                    const telemetry = typeof syncEngine.getTelemetryStatus === 'function'
                        ? syncEngine.getTelemetryStatus()
                        : {
                            source: 'none',
                            pollingActive: false,
                            syntheticClockEnabled: false,
                            capabilities: {},
                            softSyncMode: false,
                            lastTelemetryAgeMs: null
                        };
                    const telemetryAge = telemetry.lastTelemetryAgeMs !== null
                        ? (telemetry.lastTelemetryAgeMs / 1000).toFixed(1) + 's'
                        : 'N/A';
                    const lastAppliedSeek = Number.isFinite(telemetry.lastAppliedSeek)
                        ? `${telemetry.lastAppliedSeek.toFixed(2)}s`
                        : 'N/A';
                    const lastAppliedRemoteSnapshot = telemetry.lastAppliedRemoteSnapshot
                        ? JSON.stringify(telemetry.lastAppliedRemoteSnapshot)
                        : 'N/A';
                    const lastVerifiedPlaybackTime = Number.isFinite(telemetry.lastVerifiedPlaybackTime)
                        ? `${telemetry.lastVerifiedPlaybackTime.toFixed(2)}s`
                        : 'N/A';
                    const commandVerification = telemetry.commandVerification || { total: 0, success: 0, failed: 0, rate: 0 };
                    const commandSuccessRate = Number.isFinite(commandVerification.rate)
                        ? `${commandVerification.rate.toFixed(1)}%`
                        : '0.0%';
                    const capabilityMatrix = telemetry.capabilities
                        ? `cmd=${telemetry.capabilities.supportsCommands ? 'Y' : 'N'} telem=${telemetry.capabilities.supportsTelemetry ? 'Y' : 'N'} seek=${telemetry.capabilities.supportsSeeking ? 'Y' : 'N'} rate=${telemetry.capabilities.supportsPlaybackRate ? 'Y' : 'N'}`
                        : 'N/A';

                    const metrics = metricsStore.metrics;
                    const avgDrift = metricsStore.getAverageDrift().toFixed(3) + "s";
                    const avgRtt = metricsStore.getAverageRtt(socket.rtt) + "ms";
                    
                    hud.innerHTML = `
                        <strong>Watch Together Debug HUD</strong><br>
                        Status: <span style="color: ${socket.isConnected() ? '#00ff66' : '#ff4444'}">${statusText}</span><br>
                        Room: ${roomId}<br>
                        Host: ${hostId}<br>
                        FSM State: <span style="color: #00e5ff">${fsmState}</span><br>
                        Confidence: <span style="color: #f5a623">${confidence}</span><br>
                        Role: ${socket.isHost ? "HOST" : "GUEST"}<br>
                        Adapter: ${adapterType}<br>
                        RTT: ${socket.rtt || 0}ms (Avg: ${avgRtt})<br>
                        Last Sync: ${lastSyncAge}<br>
                        Telemetry Source: ${telemetry.source || 'none'}<br>
                        Telemetry Age: ${telemetryAge}<br>
                        Force Hard Sync: ${telemetry.forceHardSync ? 'YES' : 'NO'}<br>
                        Polling Active: ${telemetry.pollingActive ? 'YES' : 'NO'}<br>
                        Synthetic Clock: ${telemetry.syntheticClockEnabled ? 'YES' : 'NO'}<br>
                        Soft Sync Mode: ${telemetry.softSyncMode ? 'YES' : 'NO'}<br>
                        Last Applied Seek: ${lastAppliedSeek}<br>
                        Last Remote Snapshot: ${lastAppliedRemoteSnapshot}<br>
                        Last Verified Playback Time: ${lastVerifiedPlaybackTime}<br>
                        Provider Command Success Rate: ${commandSuccessRate} (${commandVerification.success}/${commandVerification.total})<br>
                        Capabilities: ${capabilityMatrix}<br>
                        Heartbeat Age: ${age}<br>
                        Tab Visibility: ${vis}<br>
                        Local Playhead: ${localTime.toFixed(2)}s<br>
                        Host Playhead: ${hostTime.toFixed(2)}s<br>
                        Drift: <span style="color: ${Math.abs(drift) > syncEngine.maxDriftSeconds ? '#ff4444' : '#00ff66'}">${drift.toFixed(3)}s</span> (Avg: ${avgDrift})<br>
                        Max Allowed Drift: ${syncEngine.maxDriftSeconds}s<br>
                        Current Event: ${lastPlaybackEvent}<br>
                        Provider Cmd: ${lastProviderCommand}<br>
                        <hr style="border:0;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0;">
                        <strong>Metrics:</strong><br>
                        Hard Seeks: ${metrics.hardSeeksCount}<br>
                        Stalls: ${metrics.stallsCount}<br>
                        Recovery Seeks: ${metrics.recoveryAttempts}<br>
                        Iframe Reloads: ${metrics.providerReloads}<br>
                        Socket Reconnects: ${metrics.reconnectCount}<br>
                        Heartbeat Misses: ${metrics.heartbeatMisses}<br>
                        <button id="vailismForceSyncBtn" style="margin-top:6px;padding:4px 8px;background:#00e5ff;color:#001014;border:0;border-radius:4px;cursor:pointer;font-weight:600;">Force Sync Now</button>
                    `;

                    const forceSyncBtn = document.getElementById('vailismForceSyncBtn');
                    if (forceSyncBtn && !forceSyncBtn.dataset.bound) {
                        forceSyncBtn.dataset.bound = '1';
                        forceSyncBtn.addEventListener('click', () => {
                            this.eventBus.emit('FORCE_SYNC_NOW', { source: 'hud' });
                        });
                    }
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
