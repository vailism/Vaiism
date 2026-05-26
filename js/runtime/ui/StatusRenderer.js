export class StatusRenderer {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.escapeHTML = window.escapeHTML || ((str) => String(str).replace(/[&<>'"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[m])));
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        // Redraw status cards on FSM state updates, quality change, confidence level, or RTT ping responses
        this.eventBus.on("FSM_TRANSITION", () => {
            this.updateStatusUI();
            this.updateConnectionQualityBadge();
        });

        this.eventBus.on("SOCKET_CONNECTED", () => {
            this.updateStatusUI();
            this.updateConnectionQualityBadge();
        });

        this.eventBus.on("ROOM_CREATED", () => {
            this.updateStatusUI();
        });

        this.eventBus.on("ROOM_JOINED", () => {
            this.updateStatusUI();
        });

        this.eventBus.on("PRESENCE_UPDATED", () => {
            this.updateStatusUI();
        });

        this.eventBus.on("REMOTE_SYNC_RECEIVED", () => {
            this.updateStatusUI();
        });

        this.eventBus.on("SYNC_EVENT_EMITTED", () => {
            this.updateStatusUI();
        });
        
        this.eventBus.on("SYNC_CONFIDENCE_CHANGED", () => {
            this.updateStatusUI();
            this.updateConnectionQualityBadge();
        });

        this.eventBus.on("RTT_MEASURED", () => {
            this.updateConnectionQualityBadge();
        });
        
        this.eventBus.on("SOCKET_DISCONNECTED", () => {
            this.updateConnectionQualityBadge("disconnected");
        });
        
        this.eventBus.on("SOCKET_CONNECT_ERROR", () => {
            this.updateConnectionQualityBadge("error");
        });
        
        this.eventBus.on("SOCKET_CONNECT_INITIATED", () => {
            this.updateConnectionQualityBadge("connecting");
        });
    }

    onStop() {}

    updateStatusUI(text, stateClass) {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.status", "updateStatusUI", () => {
            const container = document.getElementById("jaas-chat-iframe-container");
            if (!container) return;

            let displayStatus = text;
            let stateDotClass = stateClass;

            const fsm = this.kernel.get("fsm");
            const fsmState = fsm ? fsm.currentState : "IDLE";
            const socket = this.kernel.get("socket");
            const isHost = socket ? socket.isHost : false;
            const roomManager = this.kernel.get("recovery.reconnect");
            const roomId = roomManager ? roomManager.roomId : null;
            const presence = this.kernel.get("network.presence");
            const hostId = presence ? presence.hostId : null;
            const socketId = socket ? socket.getSocketId() : null;
            const confidenceManager = this.kernel.get("sync.confidence");
            const confidence = confidenceManager ? confidenceManager.getConfidence() : "synced";
            const syncEngine = this.kernel.get("sync");
            const lastPlaybackEvent = syncEngine ? syncEngine.lastPlaybackEvent : null;
            
            const stateMapping = {
                "IDLE": { label: "Offline", dotClass: "error" },
                "CONNECTING": { label: "Connecting...", dotClass: "connecting" },
                "JOINING": { label: "Joining Room...", dotClass: "connecting" },
                "BUFFERING": { label: "Buffering Stream", dotClass: "connecting" },
                "READY": { label: "Ready", dotClass: "connected" },
                "PLAYING": { label: isHost ? "You are the Host" : "Synced", dotClass: isHost ? "host" : "connected" },
                "PAUSED": { label: isHost ? "You are the Host" : "Synced", dotClass: isHost ? "host" : "connected" },
                "SYNCING": { label: "Synchronizing...", dotClass: "connecting" },
                "STALLED": { label: "Playback Stalled", dotClass: "error" },
                "RECOVERING": { label: "Recovering Sync...", dotClass: "connecting" },
                "DISCONNECTED": { label: "Disconnected", dotClass: "error" },
                "FAILED": { label: "Connection Failed", dotClass: "error" }
            };

            if (!socket || !socket.isConnected()) {
                displayStatus = displayStatus || "Offline";
                stateDotClass = stateDotClass || "error";
            } else if (!displayStatus) {
                if (fsmState === "JOINING") {
                    displayStatus = "Joined Room";
                    stateDotClass = "connecting";
                } else if (fsmState === "BUFFERING" || confidence === "buffering") {
                    displayStatus = "Buffering Stream";
                    stateDotClass = "connecting";
                } else if (socket.isHost || hostId === socketId) {
                    displayStatus = "Host Online";
                    stateDotClass = "host";
                } else if (fsmState === "PLAYING" || fsmState === "PAUSED" || fsmState === "READY") {
                    displayStatus = "Sync Active";
                    stateDotClass = "connected";
                } else if (roomId) {
                    displayStatus = "Connected";
                    stateDotClass = "connected";
                } else if (stateMapping[fsmState]) {
                    displayStatus = stateMapping[fsmState].label;
                    stateDotClass = stateMapping[fsmState].dotClass;
                }
            }

            if (syncEngine && syncEngine.isSyncFrozen()) {
                displayStatus = "Sync Paused";
                stateDotClass = "connecting";
            } else if (confidence === "stabilizing" && (fsmState === "PLAYING" || fsmState === "PAUSED" || fsmState === "SYNCING")) {
                displayStatus = "Sync Stabilizing";
                stateDotClass = "connecting";
            } else if (confidence === "delayed") {
                displayStatus = "Playback Stalled";
                stateDotClass = "error";
            } else if (confidence === "unstable") {
                displayStatus = "Sync Degrading";
                stateDotClass = "connecting";
            }

            container.innerHTML = `
                <div class="party-status-card ${stateDotClass || 'connected'}">
                    <div class="party-status-dot"></div>
                    <div class="party-status-details">
                        <span class="party-status-label">Room Status</span>
                        <span class="party-status-value">${displayStatus || 'Synced'}</span>
                    </div>
                </div>
            `;
        });
    }

    updateConnectionQualityBadge(state = null) {
        const failureIsolation = this.kernel.get("recovery.failureIsolation");
        failureIsolation.runSafe("ui.status", "updateConnectionQualityBadge", () => {
            const badge = document.getElementById("partyConnectionBadge");
            if (!badge) return;

            badge.className = "party-badge"; // Reset classes
            let statusText = "Connected";
            let stateClass = "connected";

            const socket = this.kernel.get("socket");
            const isHost = socket ? socket.isHost : false;
            const monitor = this.kernel.get("network.quality");
            const currentRtt = monitor ? monitor.rtt : 0;

            if (state) {
                stateClass = state;
                if (state === 'connecting') statusText = 'Connecting to Sync Server...';
                else if (state === 'reconnecting') statusText = 'Reconnecting to Sync Server...';
                else if (state === 'disconnected') statusText = 'Disconnected from Server';
                else if (state === 'error') statusText = 'Sync Connection Error';
                else if (state === 'host') statusText = 'Connected (Host Controller)';
            } else {
                const fsm = this.kernel.get("fsm");
                const fsmState = fsm ? fsm.currentState : "IDLE";
                const confidenceManager = this.kernel.get("sync.confidence");
                const confidence = confidenceManager ? confidenceManager.getConfidence() : "synced";
                
                if (fsmState === "CONNECTING" || fsmState === "JOINING" || fsmState === "RECOVERING") {
                    stateClass = "connecting";
                    statusText = "Connecting...";
                } else if (fsmState === "DISCONNECTED") {
                    stateClass = "disconnected";
                    statusText = "Disconnected from Server";
                } else if (fsmState === "FAILED") {
                    stateClass = "error";
                    statusText = "Sync Connection Error";
                } else if (confidence === "recovering") {
                    stateClass = "reconnecting";
                    statusText = "Sync recovering...";
                } else if (confidence === "buffering") {
                    stateClass = "connecting";
                    statusText = "Buffering stream...";
                } else if (confidence === "stabilizing") {
                    stateClass = "poor";
                    statusText = `Sync stabilizing... (${currentRtt}ms RTT)`;
                } else if (confidence === "delayed") {
                    stateClass = "poor";
                    statusText = "Playback delayed";
                } else if (confidence === "unstable") {
                    stateClass = "poor";
                    statusText = `Sync unstable (expanded drift tolerance)`;
                } else if (currentRtt > 300) {
                    stateClass = "poor";
                    statusText = `Poor Connection Latency (${currentRtt}ms RTT)`;
                } else {
                    stateClass = isHost ? 'host' : 'connected';
                    statusText = `Connected (${currentRtt}ms RTT)`;
                }
            }

            badge.classList.add(stateClass);
            badge.title = statusText;
        });
    }
}
