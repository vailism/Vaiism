/**
 * @file SyncManager.js
 * @description Controls playback synchronization, PID drift adjustments, host lease heartbeats, and causal ordering.
 */
import { PARTY_CONFIG } from './config.js';
import { OfflineQueue } from './OfflineQueue.js';

export class SyncManager {
    /**
     * @param {RoomManager} roomManager Room coordinator instance
     * @param {HTMLElement} playerWrapper DOM node wrapping the video player iframe
     */
    constructor(roomManager, playerWrapper) {
        this.room = roomManager;
        this.wrapper = playerWrapper;
        
        this.isSyncingLocal = false;
        this.syncOnlyHost = true;
        this.hasReceivedPlaybackEvent = false;

        // Sequence tracking map (sessionId -> seq)
        this.lastProcessedSequences = new Map();
        
        // PID Drift Variables
        this.Kp = PARTY_CONFIG.SYNC.PID.KP;
        this.Ki = PARTY_CONFIG.SYNC.PID.KI;
        this.Kd = PARTY_CONFIG.SYNC.PID.KD;
        this.prevError = 0;
        this.integral = 0;
        this.lastPIDUpdateTime = Date.now();

        // Host Heartbeat & Lease states
        this.heartbeatTimer = null;
        this.leaseMonitorTimer = null;
        this.lastHostHeartbeatTime = Date.now();
        this.connectionTimestamp = Date.now(); // Used as vote weight in elections

        // Offline actions backup
        this.offlineQueue = new OfflineQueue();

        this.unsubscribes = [];
        this._setupSyncPlane();
    }

    _setupSyncPlane() {
        const bus = this.room.bus;

        // Bind incoming logical network messages
        this.unsubscribes.push(bus.on("syncCommand", (envelope) => this._handleRemoteSync(envelope)));
        
        // Bind local player postMessage events
        const handlePlayerMsg = (e) => this._handleLocalPlayerMessage(e);
        window.addEventListener("message", handlePlayerMsg);
        this.unsubscribes.push(() => window.removeEventListener("message", handlePlayerMsg));

        // Bind visibility API state changes for background suspension
        const handleVisibility = () => this._onVisibilityChange();
        document.addEventListener("visibilitychange", handleVisibility);
        this.unsubscribes.push(() => document.removeEventListener("visibilitychange", handleVisibility));

        // Bind network status tracking
        const handleOnline = () => this._onNetworkRestore();
        window.addEventListener("online", handleOnline);
        this.unsubscribes.push(() => window.removeEventListener("online", handleOnline));

        // Start lease timers
        this._startLeaseMonitoring();
        if (this.room.isHost) {
            this._startHeartbeatBroadcasting();
        }
    }

    /**
     * Periodically broadcasts heartbeat sequences if local user is host.
     */
    _startHeartbeatBroadcasting() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        
        this.heartbeatTimer = setInterval(() => {
            this.getPlayerTime().then(currentTime => {
                this.room.broadcastCommand("playback", "HEARTBEAT", {
                    currentTime,
                    playing: this.hasReceivedPlaybackEvent
                });
            });
        }, PARTY_CONFIG.SECURITY.LEASE_HEARTBEAT_MS);
    }

    /**
     * Monitors host status and triggers election routine on lease dropout.
     */
    _startLeaseMonitoring() {
        if (this.leaseMonitorTimer) clearInterval(this.leaseMonitorTimer);

        this.leaseMonitorTimer = setInterval(() => {
            // Host does not monitor its own lease
            if (this.room.isHost) return;

            const timeSinceLastHeartbeat = Date.now() - this.lastHostHeartbeatTime;
            if (timeSinceLastHeartbeat > PARTY_CONFIG.SECURITY.LEASE_DURATION_MS) {
                console.warn("[SyncManager] Host lease expired. Initiating leader election...");
                this._initiateLeaderElection();
            }
        }, 1000);
    }

    _initiateLeaderElection() {
        // Broadcast local election weight
        this.room.broadcastCommand("system", "CLAIM_AUTHORITY", {
            connectionTimestamp: this.connectionTimestamp
        });
    }

    /**
     * Resolves incoming commands from signaling plane, validating sequence order.
     */
    _handleRemoteSync(envelope) {
        const { ns, event, sender, payload, seq } = envelope;

        // Discard local echo
        if (sender.sessionId === this.room.localSessionId) return;

        // Sequence Order Validation: Drop out-of-order or duplicate events
        const lastSeq = this.lastProcessedSequences.get(sender.sessionId) || 0;
        if (seq <= lastSeq) {
            console.warn(`[SyncManager] Dropped out-of-order message from ${sender.sessionId}. (seq: ${seq}, lastSeq: ${lastSeq})`);
            return;
        }
        this.lastProcessedSequences.set(sender.sessionId, seq);

        // System Elections
        if (ns === "system" && event === "CLAIM_AUTHORITY") {
            this._resolveElectionConflict(sender, payload);
            return;
        }

        // Playback Sync
        if (ns === "playback") {
            // Verify permission authority
            if (this.syncOnlyHost && !sender.isHost) return;

            this.lastHostHeartbeatTime = Date.now();
            this.isSyncingLocal = true;

            const { action, currentTime, playing } = payload;
            
            // Offset network latency using message generation timestamp
            const networkLag = (Date.now() - envelope.ts) / 1000;
            const latencyAdjustedTime = currentTime + (playing ? networkLag : 0);

            switch (event) {
                case "PLAY":
                    this.sendToPlayer({ command: "play" });
                    this._correctDrift(latencyAdjustedTime);
                    break;
                case "PAUSE":
                    this.sendToPlayer({ command: "pause" });
                    this._correctDrift(latencyAdjustedTime);
                    break;
                case "SEEK":
                    this._correctDrift(latencyAdjustedTime, true);
                    break;
                case "REQUEST_STATE":
                    if (this.room.isHost) {
                        this.getPlayerTime().then(currentTime => {
                            this.room.broadcastCommand("playback", "HEARTBEAT", {
                                currentTime,
                                playing: this.hasReceivedPlaybackEvent
                            });
                        });
                    }
                    break;
                case "HEARTBEAT":
                    if (!playing) {
                        this.sendToPlayer({ command: "pause" });
                    }
                    this._correctDrift(latencyAdjustedTime);
                    break;
            }

            // Release local event lock
            setTimeout(() => { this.isSyncingLocal = false; }, PARTY_CONFIG.SYNC.LOCAL_LOCK_TIMEOUT_MS);
        }
    }

    _resolveElectionConflict(sender, payload) {
        const { connectionTimestamp } = payload;
        
        // Check if we have higher priority (older connection timestamp wins)
        if (this.connectionTimestamp < connectionTimestamp) {
            console.log("[SyncManager] Local client has election priority. Claiming leadership...");
            this.room.isHost = true;
            this.room.broadcastCommand("system", "CLAIM_AUTHORITY", {
                connectionTimestamp: this.connectionTimestamp
            });
            this._startHeartbeatBroadcasting();
        } else {
            console.log(`[SyncManager] Yielding leadership to peer: ${sender.sessionId}`);
            this.room.isHost = false;
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = null;
            }
            this.lastHostHeartbeatTime = Date.now();
        }
    }

    /**
     * Captures local player activities and routes them to the network.
     */
    _handleLocalPlayerMessage(event) {
        if (this.isSyncingLocal) return;

        let payload = event.data;
        if (typeof payload === "string") {
            try { payload = JSON.parse(payload); } catch (e) { return; }
        }

        // Keep local buffer state updated
        if (payload?.event === "timeupdate") {
            this.hasReceivedPlaybackEvent = true;
            return;
        }

        if (payload?.type !== "PLAYER_EVENT" || !payload.data) return;

        const eventData = payload.data;
        const rawEvent = (eventData.event || eventData.type || "").toLowerCase();

        // Lock Guest changes from broadcasting if locked to Host Controls only
        if (this.syncOnlyHost && !this.room.isHost) return;

        // If offline, queue changes instead of broadcasting
        if (!navigator.onLine) {
            console.log(`[SyncManager] Network offline. Staging action: ${rawEvent}`);
            let actionType = "";
            let actionPayload = { currentTime: eventData.currentTime };
            
            if (rawEvent.includes("play")) {
                actionType = "PLAY";
                actionPayload.playing = true;
            } else if (rawEvent.includes("pause")) {
                actionType = "PAUSE";
                actionPayload.playing = false;
            } else if (rawEvent.includes("seek") || rawEvent.includes("seeked")) {
                actionType = "SEEK";
                actionPayload.playing = this.hasReceivedPlaybackEvent;
            }

            if (actionType) {
                this.offlineQueue.enqueue("playback", actionType, actionPayload);
            }
            return;
        }

        if (rawEvent.includes("play")) {
            this.room.broadcastCommand("playback", "PLAY", {
                currentTime: eventData.currentTime,
                playing: true
            });
        } else if (rawEvent.includes("pause")) {
            this.room.broadcastCommand("playback", "PAUSE", {
                currentTime: eventData.currentTime,
                playing: false
            });
        } else if (rawEvent.includes("seek") || rawEvent.includes("seeked")) {
            this.room.broadcastCommand("playback", "SEEK", {
                currentTime: eventData.currentTime,
                playing: this.hasReceivedPlaybackEvent
            });
        }
    }

    /**
     * Evaluates playhead deviation and corrects drift using PID control.
     */
    _correctDrift(targetSeconds, forceImmediate = false) {
        this.getPlayerTime().then(localSeconds => {
            const drift = targetSeconds - localSeconds;
            const absDrift = Math.abs(drift);

            // Dead zone: ignore offsets under 150ms
            if (absDrift < 0.15) {
                this.sendToPlayer({ command: "setPlaybackRate", rate: 1.0 });
                return;
            }

            // Hard Alignment Seek: offset exceeds limit
            if (forceImmediate || absDrift >= PARTY_CONFIG.SYNC.DRIFT_THRESHOLD_SECONDS) {
                console.log(`[SyncManager] Performing alignment seek: local=${localSeconds}s, target=${targetSeconds}s`);
                this.sendToPlayer({ command: "seek", time: targetSeconds });
                this.sendToPlayer({ command: "setPlaybackRate", rate: 1.0 });
                this.integral = 0; // Clear PID integral term on hard seek
                return;
            }

            // Micro adjustments via PID Loop: drift is between 0.15s and 1.5s
            const now = Date.now();
            const dt = (now - this.lastPIDUpdateTime) / 1000;
            if (dt <= 0) return;

            // Reset integral term on sign changes to prevent overshoot windup
            if (Math.sign(drift) !== Math.sign(this.prevError)) {
                this.integral = 0;
            }

            this.integral += drift * dt;
            this.integral = Math.max(-2, Math.min(2, this.integral)); // Clamp windup

            const derivative = (drift - this.prevError) / dt;
            this.prevError = drift;
            this.lastPIDUpdateTime = now;

            const adjustment = (this.Kp * drift) + (this.Ki * this.integral) + (this.Kd * derivative);
            const rateMultiplier = Math.max(0.90, Math.min(1.10, 1.0 + adjustment));

            this.sendToPlayer({ command: "setPlaybackRate", rate: rateMultiplier });
        });
    }

    sendToPlayer(data) {
        const iframe = this.wrapper.querySelector("iframe");
        if (iframe?.contentWindow) {
            iframe.contentWindow.postMessage(JSON.stringify(data), "*");
            // Bridge compatibility functions for multi-source embeds
            if (data.command === "play") {
                iframe.contentWindow.postMessage(JSON.stringify({ method: "play" }), "*");
            } else if (data.command === "pause") {
                iframe.contentWindow.postMessage(JSON.stringify({ method: "pause" }), "*");
            } else if (data.command === "seek") {
                iframe.contentWindow.postMessage(JSON.stringify({ method: "seek", value: data.time }), "*");
            } else if (data.command === "setPlaybackRate") {
                iframe.contentWindow.postMessage(JSON.stringify({ method: "setPlaybackRate", value: data.rate }), "*");
            }
        }
    }

    getPlayerTime() {
        const iframe = this.wrapper.querySelector("iframe");
        return new Promise((resolve) => {
            if (!iframe?.contentWindow) return resolve(0);
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
                let data = event.data;
                if (typeof data === "string") {
                    try { data = JSON.parse(data); } catch(ex) {}
                }
                if (data?.data) data = data.data;
                resolve(data?.currentTime || data?.time || 0);
            };
            iframe.contentWindow.postMessage(
                JSON.stringify({ command: "getCurrentTime" }),
                "*",
                [channel.port2]
            );
            setTimeout(() => resolve(0), 120);
        });
    }

    getPlayerDuration() {
        const iframe = this.wrapper.querySelector("iframe");
        return new Promise((resolve) => {
            if (!iframe?.contentWindow) return resolve(0);
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => {
                let data = event.data;
                if (typeof data === "string") {
                    try { data = JSON.parse(data); } catch(ex) {}
                }
                if (data?.data) data = data.data;
                resolve(data?.duration || data?.length || 0);
            };
            iframe.contentWindow.postMessage(
                JSON.stringify({ command: "getDuration" }),
                "*",
                [channel.port2]
            );
            setTimeout(() => resolve(0), 120);
        });
    }

    _onVisibilityChange() {
        const isHidden = document.visibilityState === "hidden";
        console.log(`[SyncManager] Visibility changed: ${document.visibilityState}`);

        if (isHidden) {
            // Background Tab Suspension: Stop outgoing heartbeats
            if (this.heartbeatTimer) {
                clearInterval(this.heartbeatTimer);
                this.heartbeatTimer = null;
            }
            
            // Constrain JaaS receiver parameters to halt video packets
            if (this.room.api) {
                try {
                    this.room.api.executeCommand("setReceiverConstraints", {
                        lastN: 0,
                        defaultConstraints: { maxHeight: 0 }
                    });
                } catch (e) {
                    console.warn("[SyncManager] Failed to apply background receiver constraints:", e);
                }
            }
        } else {
            // Foreground Tab Activation: Restart heartbeats (if Host)
            if (this.room.isHost) {
                this._startHeartbeatBroadcasting();
            } else {
                // Guests request immediate sync catch-up response
                this.room.broadcastCommand("playback", "REQUEST_STATE", {});
            }

            // Restore normal receiver constraints
            if (this.room.api) {
                try {
                    this.room.api.executeCommand("setReceiverConstraints", {
                        lastN: 20,
                        defaultConstraints: { maxHeight: 720 }
                    });
                } catch (e) {
                    console.warn("[SyncManager] Failed to restore receiver constraints:", e);
                }
            }
        }
    }

    _onNetworkRestore() {
        console.log("[SyncManager] Connection restored. Replaying queued offline actions...");
        this.offlineQueue.flush(this.room);
    }

    destroy() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.leaseMonitorTimer) clearInterval(this.leaseMonitorTimer);
        
        this.unsubscribes.forEach(fn => fn());
        this.unsubscribes = [];
        this.lastProcessedSequences.clear();
        this.wrapper = null;
        this.room = null;
    }
}
