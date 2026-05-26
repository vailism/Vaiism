/**
 * @file runtime-bundle.js
 * @description Pre-bundled classic-script version of the Vailism Watch Together modular runtime.
 *
 * WHY THIS EXISTS:
 * The original runtime-bootstrap.js uses ES module imports (type="module").
 * ES modules are deferred and execute AFTER all classic <script> blocks.
 * The main player IIFE is a classic script, so window.startModularWatchTogether
 * was always undefined when checked — causing the "[VAILISM] startModularWatchTogether
 * is not defined" error.
 *
 * This file concatenates all runtime classes into a single IIFE loaded as a
 * classic script, ensuring window.startModularWatchTogether is available before
 * the player IIFE executes.
 *
 * The modular source files under js/runtime/ are preserved as the canonical
 * source of truth for development and future bundler integration.
 */
(function () {
    'use strict';

    console.log("[VAILISM BOOT] Runtime bundle loading...");

    // ═══════════════════════════════════════════════════════════════════════
    // CORE: EventBus
    // ═══════════════════════════════════════════════════════════════════════
    class EventBus {
        constructor() {
            this.listeners = new Map();
            this.wildcardListeners = [];
        }

        on(event, callback) {
            if (event === '*') {
                this.wildcardListeners.push(callback);
                return () => this.off('*', callback);
            }
            if (!this.listeners.has(event)) {
                this.listeners.set(event, []);
            }
            this.listeners.get(event).push(callback);
            return () => this.off(event, callback);
        }

        off(event, callback) {
            if (event === '*') {
                this.wildcardListeners = this.wildcardListeners.filter(cb => cb !== callback);
                return;
            }
            if (!this.listeners.has(event)) return;
            const list = this.listeners.get(event).filter(cb => cb !== callback);
            if (list.length === 0) {
                this.listeners.delete(event);
            } else {
                this.listeners.set(event, list);
            }
        }

        emit(event, data = null) {
            this.wildcardListeners.forEach(cb => {
                try { cb(event, data); } catch (e) { console.error("[EventBus] Wildcard Error:", e); }
            });

            const list = this.listeners.get(event);
            if (!list) return;
            
            const targets = [...list];
            for (let i = 0; i < targets.length; i++) {
                try {
                    targets[i](data);
                } catch (e) {
                    console.error("[EventBus] Error in listener for " + event + ":", e);
                }
            }
        }

        clear() {
            this.listeners.clear();
            this.wildcardListeners = [];
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CORE: RuntimeLogger
    // ═══════════════════════════════════════════════════════════════════════
    class RuntimeLogger {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.logs = [];
            this.maxLogsCount = 100;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            if (this.eventBus) {
                this.eventBus.on('*', (event, payload) => {
                    this.log("info", event, payload);
                });
            }
        }

        onStop() {
            this.logs = [];
        }

        log(severity, event, payload) {
            var logEntry = {
                ts: Date.now(),
                subsystem: this._inferSubsystem(event),
                level: severity,
                event: event,
                payload: payload || null
            };
            
            this.logs.push(logEntry);
            if (this.logs.length > this.maxLogsCount) {
                this.logs.shift();
            }

            console.log("[RuntimeLog][" + logEntry.level.toUpperCase() + "][" + logEntry.subsystem + "] " + event, payload || '');
        }

        exportTraces() {
            return JSON.stringify(this.logs, null, 2);
        }

        _inferSubsystem(event) {
            if (!event) return "unknown";
            var ev = event.toLowerCase();
            if (ev.includes("fsm") || ev.includes("kernel")) return "kernel";
            if (ev.includes("socket") || ev.includes("presence") || ev.includes("chat") || ev.includes("typing") || ev.includes("rtt")) return "network";
            if (ev.includes("sync") || ev.includes("heartbeat") || ev.includes("drift")) return "sync";
            if (ev.includes("provider") || ev.includes("adapter")) return "provider";
            if (ev.includes("recovery") || ev.includes("watchdog") || ev.includes("stall")) return "recovery";
            if (ev.includes("ui") || ev.includes("hud") || ev.includes("toast") || ev.includes("overlay")) return "ui";
            return "core";
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CORE: MetricsStore
    // ═══════════════════════════════════════════════════════════════════════
    class MetricsStore {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.metrics = {
                driftHistory: [],
                hardSeeksCount: 0,
                reconnectCount: 0,
                providerReloads: 0,
                stallsCount: 0,
                rttHistory: [],
                heartbeatMisses: 0,
                recoveryAttempts: 0
            };
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            if (this.eventBus) {
                this.eventBus.on("RTT_MEASURED", (rtt) => this.recordRtt(rtt));
                this.eventBus.on("DRIFT_CORRECTED", (drift) => this.recordDrift(drift));
            }
        }

        onStop() {
            this.reset();
        }

        reset() {
            this.metrics = {
                driftHistory: [],
                hardSeeksCount: 0,
                reconnectCount: 0,
                providerReloads: 0,
                stallsCount: 0,
                rttHistory: [],
                heartbeatMisses: 0,
                recoveryAttempts: 0
            };
        }

        increment(key) {
            if (this.metrics[key] !== undefined) {
                this.metrics[key]++;
                this.emitUpdate();
            }
        }

        recordRtt(rtt) {
            this.metrics.rttHistory.push(rtt);
            if (this.metrics.rttHistory.length > 50) {
                this.metrics.rttHistory.shift();
            }
            this.emitUpdate();
        }

        recordDrift(drift) {
            this.metrics.driftHistory.push(drift);
            if (this.metrics.driftHistory.length > 50) {
                this.metrics.driftHistory.shift();
            }
            this.emitUpdate();
        }

        getAverageRtt(currentRtt) {
            var history = this.metrics.rttHistory;
            if (history.length === 0) return currentRtt || 0;
            var sum = history.reduce(function(a, b) { return a + b; }, 0);
            return Math.round(sum / history.length);
        }

        getAverageDrift() {
            var history = this.metrics.driftHistory;
            if (history.length === 0) return 0;
            var sum = history.reduce(function(a, b) { return a + Math.abs(b); }, 0);
            return sum / history.length;
        }

        emitUpdate() {
            if (this.eventBus) {
                this.eventBus.emit("METRICS_UPDATED", this.metrics);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CORE: PlaybackStateMachine
    // ═══════════════════════════════════════════════════════════════════════
    class PlaybackStateMachine {
        constructor() {
            this.currentState = "IDLE";
            this.allowedTransitions = {
                "IDLE": ["CONNECTING"],
                "CONNECTING": ["JOINING", "DISCONNECTED", "FAILED", "IDLE"],
                "JOINING": ["BUFFERING", "READY", "DISCONNECTED", "FAILED", "IDLE"],
                "BUFFERING": ["READY", "STALLED", "PLAYING", "PAUSED", "DISCONNECTED", "FAILED", "IDLE"],
                "READY": ["PLAYING", "PAUSED", "SYNCING", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
                "PLAYING": ["PAUSED", "SYNCING", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
                "PAUSED": ["PLAYING", "SYNCING", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
                "SYNCING": ["PLAYING", "PAUSED", "BUFFERING", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
                "STALLED": ["RECOVERING", "PLAYING", "PAUSED", "DISCONNECTED", "FAILED", "IDLE"],
                "RECOVERING": ["PLAYING", "PAUSED", "READY", "STALLED", "DISCONNECTED", "FAILED", "IDLE"],
                "DISCONNECTED": ["CONNECTING", "IDLE"],
                "FAILED": ["CONNECTING", "IDLE"]
            };
            this.onTransitionCallbacks = [];
            this.kernel = null;
            this.eventBus = null;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {}

        onStop() {
            this.currentState = "IDLE";
            this.onTransitionCallbacks = [];
        }

        transitionTo(newState, reason) {
            reason = reason || "";
            if (this.currentState === newState) return true;
            var allowed = this.allowedTransitions[this.currentState];
            if (!allowed || !allowed.includes(newState)) {
                console.warn("[FSM] Invalid state transition: " + this.currentState + " -> " + newState + " (" + reason + ")");
                return false;
            }
            var oldState = this.currentState;
            this.currentState = newState;
            console.log("[FSM] State: " + oldState + " -> " + newState + " | Reason: " + reason);

            if (this.eventBus) {
                this.eventBus.emit("FSM_TRANSITION", {
                    currentState: newState,
                    oldState: oldState,
                    reason: reason,
                    timestamp: Date.now()
                });
            }

            this.onTransitionCallbacks.forEach(function(cb) {
                try { cb(newState, oldState, reason); } catch (e) { console.error("[FSM] Error in transition callback:", e); }
            });
            return true;
        }

        onTransition(cb) {
            this.onTransitionCallbacks.push(cb);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CORE: RuntimeKernel
    // ═══════════════════════════════════════════════════════════════════════
    class RuntimeKernel {
        constructor() {
            this.services = new Map();
            this.isStarted = false;
        }

        register(name, serviceInstance) {
            if (this.services.has(name)) {
                console.warn("[Kernel] Service " + name + " is already registered. Overwriting.");
            }
            this.services.set(name, serviceInstance);
        }

        get(name) {
            var service = this.services.get(name);
            if (!service) {
                throw new Error("[Kernel] Requested service not found: " + name);
            }
            return service;
        }

        boot() {
            var self = this;
            if (self.isStarted) return Promise.resolve();
            console.log("[VAILISM BOOT] Starting collaborative media runtime boot sequence...");

            // Inject Kernel references to all services
            self.services.forEach(function(service) {
                if (typeof service.injectKernel === 'function') {
                    service.injectKernel(self);
                }
            });

            // Boot services in logical topological order
            var bootOrder = [
                "logger", "metrics", "eventBus", "fsm",
                "recovery.failureIsolation",
                "socket", "network.presence", "network.quality", "provider.health",
                "sync.confidence", "sync.snapshots", "sync.drift", "sync.heartbeats", "sync",
                "recovery.watchdog", "recovery.reconnect", "recovery",
                "ui.toast", "ui.status", "ui.presence", "ui.overlay", "ui.hud"
            ];

            var chain = Promise.resolve();
            bootOrder.forEach(function(name) {
                chain = chain.then(function() {
                    if (self.services.has(name)) {
                        var service = self.services.get(name);
                        if (typeof service.onStart === 'function') {
                            console.log("[VAILISM BOOT] Booting service: " + name);
                            return Promise.resolve(service.onStart());
                        }
                    }
                    return Promise.resolve();
                });
            });

            return chain.then(function() {
                self.isStarted = true;
                console.log("[VAILISM BOOT] Collaborative media runtime successfully booted!");
                var eventBus = self.services.get("eventBus");
                if (eventBus) {
                    eventBus.emit("KERNEL_BOOT_COMPLETE", { timestamp: Date.now() });
                }
            });
        }

        shutdown() {
            var self = this;
            if (!self.isStarted) return Promise.resolve();
            console.log("[VAILISM BOOT] Shutting down media runtime...");

            var shutdownOrder = [
                "ui.hud", "ui.overlay", "ui.presence", "ui.status", "ui.toast",
                "recovery", "recovery.reconnect", "recovery.watchdog",
                "sync", "sync.heartbeats", "sync.drift", "sync.snapshots", "sync.confidence",
                "provider.health", "network.quality", "network.presence", "socket",
                "recovery.failureIsolation", "fsm", "eventBus", "metrics", "logger"
            ];

            var chain = Promise.resolve();
            shutdownOrder.forEach(function(name) {
                chain = chain.then(function() {
                    if (self.services.has(name)) {
                        var service = self.services.get(name);
                        if (typeof service.onStop === 'function') {
                            try {
                                return Promise.resolve(service.onStop());
                            } catch (e) {
                                console.error("[Kernel] Error stopping service " + name + ":", e);
                            }
                        }
                    }
                    return Promise.resolve();
                });
            });

            return chain.then(function() {
                self.isStarted = false;
                self.services.clear();
                console.log("[VAILISM BOOT] Runtime terminated cleanly.");
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RECOVERY: FailureIsolation
    // ═══════════════════════════════════════════════════════════════════════
    class FailureIsolation {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {}
        onStop() {}

        runSafe(subsystem, actionName, fn, fallback) {
            try {
                return fn();
            } catch (e) {
                console.error("[FailureIsolation][" + subsystem + "] Error during " + actionName + ":", e);
                if (this.eventBus) {
                    this.eventBus.emit("SUB_SYSTEM_CRASHED", { subsystem: subsystem, actionName: actionName, error: e.message });
                }
                if (fallback) {
                    try { return fallback(e); } catch (fallbackError) {
                        console.error("[FailureIsolation] Error in fallback function:", fallbackError);
                    }
                }
                return null;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NETWORKING: SocketManager
    // ═══════════════════════════════════════════════════════════════════════
    class SocketManager {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.socket = null;
            this.isHost = false;
            this.rtt = 0;
            this.serverUrl = (window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1'))
                ? 'http://localhost:3000'
                : 'https://vailism-sync.onrender.com';
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {}

        onStop() {
            this.disconnect();
        }

        connect(userName, connectionCallback) {
            var self = this;
            if (self.socket) {
                console.warn("[SocketManager] Socket already exists. Disconnecting old session.");
                self.disconnect();
            }

            console.log("[VAILISM SOCKET] Connecting to sync server: " + self.serverUrl);
            self.eventBus.emit("SOCKET_CONNECT_INITIATED", { url: self.serverUrl });

            var io = window.io;
            if (!io) {
                console.error("[SocketManager] socket.io-client library (window.io) not found!");
                self.eventBus.emit("SOCKET_ERROR_RECEIVED", { message: "Socket.io library missing" });
                return;
            }

            self.socket = io(self.serverUrl, {
                transports: ['websocket'],
                reconnectionAttempts: Infinity,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                timeout: 20000
            });

            self.socket.on('connect', function() {
                console.log("[VAILISM SOCKET] Connected! Socket ID: " + self.socket.id);
                console.log('[VAILISM SOCKET] Connected');
                self.eventBus.emit("SOCKET_CONNECTED", { socketId: self.socket.id });
                if (connectionCallback) {
                    try { connectionCallback(); } catch (e) {
                        console.error("[SocketManager] Error in connect callback:", e);
                    }
                }
            });

            self.socket.on('disconnect', function(reason) {
                console.warn("[SocketManager] Disconnected. Reason: " + reason);
                self.eventBus.emit("SOCKET_DISCONNECTED", { reason: reason });
            });

            self.socket.on('connect_error', function(error) {
                console.error('[SocketManager] Connection error:', error);
                self.eventBus.emit("SOCKET_CONNECT_ERROR", { message: error ? error.message : "Unknown error" });
            });

            self.socket.on('sync-state', function(data) {
                self.eventBus.emit("REMOTE_SYNC_RECEIVED", data);
            });

            self.socket.on('chat-message', function(data) {
                self.eventBus.emit("CHAT_MESSAGE_RECEIVED", data);
            });

            self.socket.on('typing', function(data) {
                self.eventBus.emit("REMOTE_TYPING_RECEIVED", data);
            });

            self.socket.on('host-changed', function(data) {
                self.eventBus.emit("HOST_CHANGED_RECEIVED", data);
            });

            self.socket.on('user-joined', function(data) {
                self.eventBus.emit("USER_JOINED_RECEIVED", data);
            });

            self.socket.on('user-left', function(data) {
                self.eventBus.emit("USER_LEFT_RECEIVED", data);
            });

            self.socket.on('error-msg', function(data) {
                self.eventBus.emit("SOCKET_ERROR_RECEIVED", data);
            });
        }

        disconnect() {
            if (this.socket) {
                try { this.socket.disconnect(); } catch (e) {
                    console.error("[SocketManager] Error on disconnect:", e);
                }
                this.socket = null;
            }
        }

        createRoom(videoId, videoType, hostName, callback) {
            if (!this.socket) return;
            var self = this;
            this.socket.emit('create-room', { videoId: videoId, videoType: videoType, hostName: hostName }, function(res) {
                if (callback) {
                    try { callback(res); } catch (e) {
                        console.error("[SocketManager] Error in createRoom callback:", e);
                    }
                }
                if (res && !res.error) {
                    console.log('[VAILISM ROOM] Created room ' + res.roomId);
                    self.eventBus.emit('ROOM_CREATED', { roomId: res.roomId, hostName: hostName, videoId: videoId, videoType: videoType });
                }
            });
        }

        joinRoom(roomId, userName, callback) {
            if (!this.socket) return;
            var self = this;
            this.socket.emit('join-room', { roomId: roomId, userName: userName }, function(res) {
                if (callback) {
                    try { callback(res); } catch (e) {
                        console.error("[SocketManager] Error in joinRoom callback:", e);
                    }
                }
                if (res && !res.error) {
                    console.log('[VAILISM ROOM] Joined room ' + roomId);
                    self.eventBus.emit('ROOM_JOINED', { roomId: roomId, userName: userName, room: res.room || null });
                }
            });
        }

        emitSyncEvent(data) {
            if (!this.socket) return;
            console.log('[VAILISM SYNC] Emitting ' + String(data && data.action ? data.action : 'SYNC').toUpperCase(), data);
            this.socket.emit('sync-event', data);
            this.eventBus.emit('SYNC_EVENT_EMITTED', data);
        }

        emitChatMessage(text) {
            if (!this.socket) return;
            this.socket.emit('chat-message', { text: text });
        }

        emitTyping(isTyping) {
            if (!this.socket) return;
            this.socket.emit('typing', { isTyping: isTyping });
        }

        emitHeartbeat() {
            if (!this.socket) return;
            console.log('[VAILISM HEARTBEAT] Emitting heartbeat');
            this.socket.emit('heartbeat');
        }

        once(event, handler) {
            if (!this.socket) return;
            this.socket.once(event, handler);
        }

        isConnected() {
            return this.socket && this.socket.connected;
        }

        getSocketId() {
            return this.socket ? this.socket.id : null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NETWORKING: PresenceManager
    // ═══════════════════════════════════════════════════════════════════════
    class PresenceManager {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.participants = new Map();
            this.activeTypers = new Map();
            this.isLocallyTyping = false;
            this.localTypingTimeout = null;
            this.hostId = null;
            this.isHost = false;
            this.username = '';
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.participants.clear();
            self.activeTypers.clear();
            self.isLocallyTyping = false;
            self.hostId = null;
            self.isHost = false;

            self.eventBus.on("SOCKET_CONNECTED", function() {
                self.participants.clear();
                self.activeTypers.clear();
            });

            self.eventBus.on("SOCKET_DISCONNECTED", function() {
                self.activeTypers.forEach(function(typer) {
                    try { clearTimeout(typer.timeout); } catch(e) {}
                });
                self.activeTypers.clear();
                self.eventBus.emit("TYPING_UPDATED", { activeTypers: self.activeTypers });
            });

            self.eventBus.on("HOST_CHANGED_RECEIVED", function(data) {
                try {
                    var socket = self.kernel.get("socket");
                    self.isHost = (data.hostId === socket.getSocketId());
                    self.hostId = data.hostId;
                    self.updateParticipants(data.participants);
                } catch (e) {
                    console.error("[PresenceManager] Error in host-changed handler:", e);
                }
            });

            self.eventBus.on("USER_JOINED_RECEIVED", function(data) {
                self.updateParticipants(data.participants);
            });

            self.eventBus.on("USER_LEFT_RECEIVED", function(data) {
                self.updateParticipants(data.participants);
                if (self.activeTypers.has(data.socketId)) {
                    clearTimeout(self.activeTypers.get(data.socketId).timeout);
                    self.activeTypers.delete(data.socketId);
                    self.eventBus.emit("TYPING_UPDATED", { activeTypers: self.activeTypers });
                }
            });

            self.eventBus.on("REMOTE_TYPING_RECEIVED", function(data) {
                self.handleRemoteTyping(data);
            });
        }

        onStop() {
            if (this.localTypingTimeout) clearTimeout(this.localTypingTimeout);
            this.activeTypers.forEach(function(typer) {
                try { clearTimeout(typer.timeout); } catch(e) {}
            });
            this.participants.clear();
            this.activeTypers.clear();
        }

        updateParticipants(participantsList) {
            this.participants.clear();
            var self = this;
            participantsList.forEach(function(p) {
                self.participants.set(p.socketId, { id: p.socketId, displayName: p.name });
            });
            this.eventBus.emit("PRESENCE_UPDATED", {
                participants: this.participants,
                hostId: this.hostId,
                isHost: this.isHost
            });
        }

        handleRemoteTyping(data) {
            var self = this;
            var senderId = data.senderId;
            var senderName = data.senderName;
            var isTyping = data.isTyping;
            
            if (self.activeTypers.has(senderId)) {
                clearTimeout(self.activeTypers.get(senderId).timeout);
                self.activeTypers.delete(senderId);
            }

            if (isTyping) {
                var timeout = setTimeout(function() {
                    try {
                        self.activeTypers.delete(senderId);
                        self.eventBus.emit("TYPING_UPDATED", { activeTypers: self.activeTypers });
                    } catch(e) {}
                }, 4000);
                self.activeTypers.set(senderId, { name: senderName, timeout: timeout });
            }

            self.eventBus.emit("TYPING_UPDATED", { activeTypers: self.activeTypers });
        }

        handleLocalTyping(isTyping) {
            var self = this;
            try {
                var socket = self.kernel.get("socket");
                if (!socket.isConnected()) return;

                if (isTyping) {
                    if (!self.isLocallyTyping) {
                        self.isLocallyTyping = true;
                        socket.emitTyping(true);
                    }
                    if (self.localTypingTimeout) clearTimeout(self.localTypingTimeout);
                    self.localTypingTimeout = setTimeout(function() {
                        self.isLocallyTyping = false;
                        socket.emitTyping(false);
                    }, 2000);
                } else {
                    self.isLocallyTyping = false;
                    if (self.localTypingTimeout) clearTimeout(self.localTypingTimeout);
                    socket.emitTyping(false);
                }
            } catch (e) {
                console.error("[PresenceManager] Error updating local typing status:", e);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // NETWORKING: ConnectionQualityMonitor
    // ═══════════════════════════════════════════════════════════════════════
    class ConnectionQualityMonitor {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.rttPingInterval = null;
            this.rtt = 0;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.rtt = 0;
            self.eventBus.on("SOCKET_CONNECTED", function() {
                self.startRttPingLoop();
            });
            self.eventBus.on("SOCKET_DISCONNECTED", function() {
                self.stopRttPingLoop();
            });
        }

        onStop() {
            this.stopRttPingLoop();
        }

        startRttPingLoop() {
            var self = this;
            self.stopRttPingLoop();
            self.rttPingInterval = setInterval(function() {
                try {
                    var socket = self.kernel.get("socket");
                    if (!socket || !socket.isConnected()) return;
                    var pingStart = Date.now();
                    
                    socket.once('heartbeat-ack', function() {
                        self.rtt = Date.now() - pingStart;
                        self.eventBus.emit("RTT_MEASURED", self.rtt);
                    });
                    socket.emitHeartbeat();
                } catch (e) {
                    console.error("[ConnectionQualityMonitor] Error in RTT ping loop:", e);
                }
            }, 5000);
        }

        stopRttPingLoop() {
            if (this.rttPingInterval) {
                clearInterval(this.rttPingInterval);
                this.rttPingInterval = null;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROVIDER: ProviderAdapter (Base)
    // ═══════════════════════════════════════════════════════════════════════
    class ProviderAdapter {
        constructor(iframe) {
            this.iframe = iframe;
            this.pollIntervalMs = 1000;
            this.hiddenPollIntervalMs = 4000;
            this.pollTimer = null;
            this.pollingActive = false;
            this.telemetryListener = null;
            this.messageListener = null;
            this.visibilityListener = null;
            this.pollCount = 0;
            this.telemetryCount = 0;
            this.syntheticClockEnabled = false;
            this.lastTelemetryAt = 0;
            this.lastTickAt = Date.now();
            this.lastKnownState = {
                currentTime: 0,
                paused: true,
                playbackRate: 1.0,
                duration: 0,
                buffering: false,
                ts: Date.now(),
                source: 'initial'
            };
            this.capabilities = {
                supportsCommands: true,
                supportsTelemetry: false,
                supportsSeeking: true,
                supportsPlaybackRate: true
            };
        }
        play() { return this.sendCommand('play'); }
        pause() { return this.sendCommand('pause'); }
        seek(time) { return this.sendCommand('seek', { time: time, currentTime: time, position: time }); }
        setPlaybackRate(rate) { return this.sendCommand('setPlaybackRate', { rate: rate, playbackRate: rate }); }
        getCapabilities() {
            return { ...this.capabilities };
        }
        setCapabilities(partial) {
            partial = partial || {};
            this.capabilities = { ...this.capabilities, ...partial };
        }
        getStateSnapshot() {
            return { ...this.lastKnownState, source: this.lastKnownState.source || 'cache' };
        }
        setTelemetryListener(listener) {
            this.telemetryListener = typeof listener === 'function' ? listener : null;
        }
        startPolling() {
            var self = this;
            if (self.pollingActive) return;
            self.pollingActive = true;
            self.pollCount = 0;
            self.telemetryCount = 0;
            self.lastTickAt = Date.now();

            self.messageListener = function(event) { self.onWindowMessage(event); };
            window.addEventListener('message', self.messageListener);

            self.visibilityListener = function() {
                self.resetPollingInterval();
                console.log('[VAILISM POLLER] Visibility changed to ' + document.visibilityState + '; poll=' + self.getCurrentPollInterval() + 'ms');
            };
            document.addEventListener('visibilitychange', self.visibilityListener);

            self.resetPollingInterval();
            console.log('[VAILISM POLLER] Polling loop started');
        }
        stopPolling() {
            this.pollingActive = false;
            if (this.pollTimer) {
                clearInterval(this.pollTimer);
                this.pollTimer = null;
            }
            if (this.messageListener) {
                window.removeEventListener('message', this.messageListener);
                this.messageListener = null;
            }
            if (this.visibilityListener) {
                document.removeEventListener('visibilitychange', this.visibilityListener);
                this.visibilityListener = null;
            }
        }
        getCurrentPollInterval() {
            return document.visibilityState === 'hidden' ? this.hiddenPollIntervalMs : this.pollIntervalMs;
        }
        resetPollingInterval() {
            var self = this;
            if (!self.pollingActive) return;
            if (self.pollTimer) clearInterval(self.pollTimer);
            self.pollTimer = setInterval(function() {
                self.pollPlaybackState();
            }, self.getCurrentPollInterval());
        }
        pollPlaybackState() {
            this.pollCount += 1;
            if (!this.iframe || !this.iframe.contentWindow) {
                return;
            }

            var queries = [
                { command: 'getCurrentTime' },
                { command: 'getPaused' },
                { command: 'getPlaybackRate' },
                { command: 'getDuration' },
                { command: 'getBuffering' },
                { type: 'getState' },
                { event: 'getState' },
                'getState'
            ];

            for (var i = 0; i < queries.length; i++) {
                var query = queries[i];
                try {
                    var payload = typeof query === 'string'
                        ? query
                        : { ...query, source: 'vailism-poller', ts: Date.now() };
                    this.iframe.contentWindow.postMessage(payload, '*');
                } catch (error) {
                    console.warn('[VAILISM POLLER] Failed to query playback state', error);
                    break;
                }
            }

            if (this.telemetryCount === 0 && this.pollCount >= 3) {
                this.setCapabilities({ supportsTelemetry: false });
            }

            var telemetryAge = Date.now() - this.lastTelemetryAt;
            if (telemetryAge > 1800) {
                this.emitSyntheticTelemetry('poll-fallback');
            }
        }
        onWindowMessage(event) {
            if (!this.iframe || !this.iframe.contentWindow) return;
            if (event.source !== this.iframe.contentWindow) return;

            var snapshot = this.extractState(event.data);
            if (!snapshot) return;

            this.telemetryCount += 1;
            this.syntheticClockEnabled = false;
            this.setCapabilities({ supportsTelemetry: true });
            this.emitTelemetry({ ...snapshot, source: snapshot.source || 'iframe' }, false);
        }
        extractState(payload) {
            var data = payload;
            if (!data) return null;

            if (typeof data === 'string') {
                try {
                    data = JSON.parse(data);
                } catch (error) {
                    return null;
                }
            }

            if (data && typeof data === 'object' && data.data && typeof data.data === 'object') {
                data = data.data;
            }

            if (!data || typeof data !== 'object') return null;

            var currentTimeRaw = data.currentTime !== undefined ? data.currentTime : (data.time !== undefined ? data.time : (data.position !== undefined ? data.position : data.progress));
            var durationRaw = data.duration !== undefined ? data.duration : (data.length !== undefined ? data.length : data.totalDuration);
            var rateRaw = data.playbackRate !== undefined ? data.playbackRate : (data.rate !== undefined ? data.rate : data.speed);
            var pausedRaw = data.paused;
            var playingRaw = data.playing;
            var bufferingRaw = data.buffering !== undefined ? data.buffering : (data.waiting !== undefined ? data.waiting : data.loading);
            var eventTypeRaw = String(data.event || data.type || data.action || '').toLowerCase();

            var hasTime = Number.isFinite(parseFloat(currentTimeRaw));
            var hasDuration = Number.isFinite(parseFloat(durationRaw));
            var hasRate = Number.isFinite(parseFloat(rateRaw));
            var hasPaused = typeof pausedRaw === 'boolean' || typeof playingRaw === 'boolean';
            var hasBuffering = typeof bufferingRaw === 'boolean';

            if (!hasTime && !hasDuration && !hasRate && !hasPaused && !hasBuffering && !eventTypeRaw) {
                return null;
            }

            var currentTime = hasTime ? parseFloat(currentTimeRaw) : this.lastKnownState.currentTime;
            var duration = hasDuration ? parseFloat(durationRaw) : this.lastKnownState.duration;
            var playbackRate = hasRate ? parseFloat(rateRaw) : this.lastKnownState.playbackRate;
            var paused = typeof pausedRaw === 'boolean'
                ? pausedRaw
                : (typeof playingRaw === 'boolean' ? !playingRaw : this.lastKnownState.paused);
            var buffering = typeof bufferingRaw === 'boolean' ? bufferingRaw : this.lastKnownState.buffering;

            return {
                type: eventTypeRaw || 'timeupdate',
                currentTime: currentTime,
                duration: duration,
                playbackRate: playbackRate,
                paused: paused,
                playing: !paused,
                buffering: buffering,
                ts: Date.now(),
                raw: data,
                source: 'provider-telemetry'
            };
        }
        emitTelemetry(snapshot, synthetic) {
            synthetic = !!synthetic;
            var now = Date.now();
            var merged = {
                ...this.lastKnownState,
                ...snapshot,
                ts: now,
                synthetic: synthetic
            };

            merged.currentTime = Number.isFinite(merged.currentTime) ? merged.currentTime : this.lastKnownState.currentTime;
            merged.duration = Number.isFinite(merged.duration) ? merged.duration : this.lastKnownState.duration;
            merged.playbackRate = Number.isFinite(merged.playbackRate) ? merged.playbackRate : this.lastKnownState.playbackRate;
            merged.paused = typeof merged.paused === 'boolean' ? merged.paused : this.lastKnownState.paused;
            merged.playing = typeof merged.playing === 'boolean' ? merged.playing : !merged.paused;
            merged.buffering = typeof merged.buffering === 'boolean' ? merged.buffering : this.lastKnownState.buffering;

            this.lastKnownState = merged;
            this.lastTickAt = now;
            this.lastTelemetryAt = now;

            if (this.telemetryListener) {
                this.telemetryListener(merged);
            }
        }
        emitSyntheticTelemetry(reason) {
            reason = reason || 'synthetic';
            var now = Date.now();
            var elapsedSeconds = (now - this.lastTickAt) / 1000;
            var rate = this.lastKnownState.playbackRate || 1.0;
            var currentTime = this.lastKnownState.currentTime || 0;

            if (!this.lastKnownState.paused && elapsedSeconds > 0) {
                currentTime += elapsedSeconds * rate;
                if (this.lastKnownState.duration > 0) {
                    currentTime = Math.min(currentTime, this.lastKnownState.duration);
                }
            }

            this.syntheticClockEnabled = true;
            console.log('[VAILISM TELEMETRY] Using synthetic telemetry fallback', {
                reason: reason,
                currentTime: currentTime,
                paused: this.lastKnownState.paused,
                playbackRate: rate
            });

            this.emitTelemetry({
                type: 'timeupdate',
                currentTime: currentTime,
                duration: this.lastKnownState.duration,
                playbackRate: rate,
                paused: this.lastKnownState.paused,
                playing: !this.lastKnownState.paused,
                buffering: this.lastKnownState.buffering,
                source: 'synthetic-clock'
            }, true);
        }
        sendCommand(command, details) {
            details = details || {};
            if (!this.iframe || !this.iframe.contentWindow) {
                console.warn('[VAILISM PROVIDER] Unable to send ' + command.toUpperCase() + ' command: iframe not ready');
                return false;
            }

            var payload = {
                event: 'command',
                type: command,
                action: command,
                command: command,
                method: command,
                timestamp: Date.now()
            };
            for (var key in details) payload[key] = details[key];

            try {
                console.log('[VAILISM PROVIDER] Sending ' + command.toUpperCase() + ' command', payload);
                this.iframe.contentWindow.postMessage(payload, '*');

                if (command === 'play') {
                    this.lastKnownState.paused = false;
                    this.lastKnownState.playing = true;
                } else if (command === 'pause') {
                    this.lastKnownState.paused = true;
                    this.lastKnownState.playing = false;
                } else if (command === 'seek') {
                    var time = Number.isFinite(parseFloat(details.time)) ? parseFloat(details.time) : this.lastKnownState.currentTime;
                    this.lastKnownState.currentTime = time;
                } else if (command === 'setPlaybackRate') {
                    var rate = Number.isFinite(parseFloat(details.rate)) ? parseFloat(details.rate) : this.lastKnownState.playbackRate;
                    this.lastKnownState.playbackRate = rate;
                }

                return true;
            } catch (error) {
                console.warn('[VAILISM PROVIDER] ' + command.toUpperCase() + ' command failed', error);
                return false;
            }
        }
        normalizeMessage(payload) { return null; }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROVIDER: VidlinkAdapter
    // ═══════════════════════════════════════════════════════════════════════
    class VidlinkAdapter extends ProviderAdapter {
        constructor(iframe) {
            super(iframe);
            this.setCapabilities({
                supportsCommands: true,
                supportsTelemetry: false,
                supportsSeeking: true,
                supportsPlaybackRate: true
            });
        }
        play() {
            return this.sendCommand("play");
        }
        pause() {
            return this.sendCommand("pause");
        }
        seek(time) {
            return this.sendCommand("seek", { time: time, currentTime: time, position: time });
        }
        setPlaybackRate(rate) {
            return this.sendCommand("setPlaybackRate", { rate: rate, playbackRate: rate });
        }
        normalizeMessage(payload) {
            var data = payload;
            if (!data || typeof data !== 'object') return null;
            if (data.data) data = data.data;
            if (typeof data === "string") {
                try { data = JSON.parse(data); } catch(ex) { return null; }
            }
            if (!data || typeof data !== 'object') return null;

            var rawEvent = String(data.event || data.type || data.action || data.command || '').toLowerCase();
            var type = null;
            if (rawEvent.includes('play') || rawEvent.includes('playing')) type = 'play';
            else if (rawEvent.includes('pause')) type = 'pause';
            else if (rawEvent.includes('timeupdate') || rawEvent.includes('progress')) type = 'timeupdate';
            else if (rawEvent.includes('ended') || rawEvent.includes('complete')) type = 'ended';
            else if (rawEvent.includes('waiting') || rawEvent.includes('buffering')) type = 'buffering';
            else if (rawEvent.includes('ready') || rawEvent.includes('loaded')) type = 'ready';

            var currentTime = parseFloat(data.currentTime !== undefined ? data.currentTime : (data.time !== undefined ? data.time : data.position)) || 0;
            var duration = parseFloat(data.duration !== undefined ? data.duration : data.length) || 0;
            var playbackRate = parseFloat(data.playbackRate !== undefined ? data.playbackRate : (data.rate !== undefined ? data.rate : 1.0)) || 1.0;
            var buffering = !!(data.buffering || rawEvent.includes('buffering') || rawEvent.includes('waiting'));

            return { type: type, currentTime: currentTime, duration: duration, playbackRate: playbackRate, buffering: buffering, raw: data };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROVIDER: VidsrcAdapter
    // ═══════════════════════════════════════════════════════════════════════
    class VidsrcAdapter extends ProviderAdapter {
        constructor(iframe) {
            super(iframe);
            this.setCapabilities({
                supportsCommands: true,
                supportsTelemetry: false,
                supportsSeeking: true,
                supportsPlaybackRate: true
            });
        }
        play() {
            return this.sendCommand("play");
        }
        pause() {
            return this.sendCommand("pause");
        }
        seek(time) {
            return this.sendCommand("seek", { time: time, currentTime: time, position: time });
        }
        setPlaybackRate(rate) {
            return this.sendCommand("setPlaybackRate", { rate: rate, playbackRate: rate });
        }
        normalizeMessage(payload) {
            var data = payload;
            if (!data || typeof data !== 'object') return null;
            var rawEvent = String(data.event || data.type || data.action || data.command || '').toLowerCase();
            var type = null;
            if (rawEvent.includes('play')) type = 'play';
            else if (rawEvent.includes('pause')) type = 'pause';
            else if (rawEvent.includes('timeupdate')) type = 'timeupdate';
            var currentTime = parseFloat(data.time || data.currentTime) || 0;
            var duration = parseFloat(data.duration) || 0;
            return { type: type, currentTime: currentTime, duration: duration, playbackRate: 1.0, buffering: false, raw: data };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROVIDER: VideasyAdapter
    // ═══════════════════════════════════════════════════════════════════════
    class VideasyAdapter extends ProviderAdapter {
        constructor(iframe) {
            super(iframe);
            this.setCapabilities({
                supportsCommands: true,
                supportsTelemetry: false,
                supportsSeeking: true,
                supportsPlaybackRate: true
            });
        }
        play() { return this.sendCommand('play'); }
        pause() { return this.sendCommand('pause'); }
        seek(time) { return this.sendCommand('seek', { time: time, currentTime: time, position: time }); }
        setPlaybackRate(rate) { return this.sendCommand('setPlaybackRate', { rate: rate, playbackRate: rate }); }
        normalizeMessage(payload) {
            var data = payload;
            if (!data || typeof data !== 'object') return null;
            if (data.data) data = data.data;
            if (typeof data === 'string') {
                try { data = JSON.parse(data); } catch(error) { return null; }
            }
            if (!data || typeof data !== 'object') return null;

            var rawEvent = String(data.event || data.type || data.action || data.command || '').toLowerCase();
            var type = null;
            if (rawEvent.includes('play')) type = 'play';
            else if (rawEvent.includes('pause')) type = 'pause';
            else if (rawEvent.includes('timeupdate') || rawEvent.includes('progress') || rawEvent.includes('tick')) type = 'timeupdate';
            else if (rawEvent.includes('ended') || rawEvent.includes('complete')) type = 'ended';
            else if (rawEvent.includes('waiting') || rawEvent.includes('buffering')) type = 'buffering';
            else if (rawEvent.includes('ready') || rawEvent.includes('loaded')) type = 'ready';

            var currentTime = parseFloat(data.currentTime !== undefined ? data.currentTime : (data.time !== undefined ? data.time : data.position)) || 0;
            var duration = parseFloat(data.duration !== undefined ? data.duration : data.length) || 0;
            var playbackRate = parseFloat(data.playbackRate !== undefined ? data.playbackRate : (data.rate !== undefined ? data.rate : 1.0)) || 1.0;
            var buffering = !!(data.buffering || rawEvent.includes('buffering') || rawEvent.includes('waiting'));

            return { type: type, currentTime: currentTime, duration: duration, playbackRate: playbackRate, buffering: buffering, raw: data };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROVIDER: GenericIframeAdapter
    // ═══════════════════════════════════════════════════════════════════════
    class GenericIframeAdapter extends ProviderAdapter {
        constructor(iframe) {
            super(iframe);
            this.setCapabilities({
                supportsCommands: true,
                supportsTelemetry: false,
                supportsSeeking: true,
                supportsPlaybackRate: false
            });
        }
        play() {
            return this.sendCommand("play");
        }
        pause() {
            return this.sendCommand("pause");
        }
        seek(time) {
            return this.sendCommand("seek", { time: time, currentTime: time, position: time });
        }
        setPlaybackRate(rate) {
            return this.sendCommand("setPlaybackRate", { rate: rate, playbackRate: rate });
        }
        normalizeMessage(payload) {
            var data = payload;
            if (!data || typeof data !== 'object') return null;
            var rawEvent = String(data.event || data.type || data.action || data.command || '').toLowerCase();
            var type = null;
            if (rawEvent.includes('play')) type = 'play';
            else if (rawEvent.includes('pause')) type = 'pause';
            else if (rawEvent.includes('timeupdate')) type = 'timeupdate';
            var currentTime = parseFloat(data.currentTime || data.time) || 0;
            var duration = parseFloat(data.duration) || 0;
            return { type: type, currentTime: currentTime, duration: duration, playbackRate: 1.0, buffering: false, raw: data };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PROVIDER: ProviderHealthMonitor
    // ═══════════════════════════════════════════════════════════════════════
    class ProviderHealthMonitor {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.lastMessageTime = Date.now();
            this.checkInterval = null;
            this.isPlaying = false;
            this.lastTime = 0;
            this.lastProgressTime = Date.now();
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.lastMessageTime = Date.now();
            self.lastProgressTime = Date.now();
            self.lastTime = 0;

            self.eventBus.on("PLAYER_MESSAGE_RECEIVED", function() {
                self.lastMessageTime = Date.now();
            });

            self.eventBus.on("FSM_TRANSITION", function(data) {
                self.isPlaying = (data.currentState === "PLAYING");
                if (!self.isPlaying) {
                    self.lastProgressTime = Date.now();
                }
            });

            self.eventBus.on("LOCAL_PLAYER_TIME_UPDATE", function(data) {
                self.lastMessageTime = Date.now();
                if (data.currentTime !== self.lastTime) {
                    self.lastTime = data.currentTime;
                    self.lastProgressTime = Date.now();
                }
            });

            self.checkInterval = setInterval(function() {
                try {
                    var now = Date.now();
                    var messageAge = now - self.lastMessageTime;
                    var progressAge = now - self.lastProgressTime;

                    if (self.isPlaying) {
                        if (messageAge > 10000) {
                            console.warn("[HealthMonitor] Detected postMessage silence of " + Math.round(messageAge / 1000) + "s.");
                            self.eventBus.emit("PROVIDER_HEALTH_DEGRADED", {
                                reason: "silence",
                                detail: "postMessage silence for " + Math.round(messageAge / 1000) + "s"
                            });
                        } else if (progressAge > 8000) {
                            console.warn("[HealthMonitor] Detected frozen playhead of " + Math.round(progressAge / 1000) + "s.");
                            self.eventBus.emit("PROVIDER_HEALTH_DEGRADED", {
                                reason: "freeze",
                                detail: "Playhead frozen for " + Math.round(progressAge / 1000) + "s"
                            });
                        }
                    }
                } catch (e) {
                    console.error("[HealthMonitor] Error in check interval:", e);
                }
            }, 3000);
        }

        onStop() {
            if (this.checkInterval) {
                clearInterval(this.checkInterval);
                this.checkInterval = null;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SYNC: SyncConfidenceManager
    // ═══════════════════════════════════════════════════════════════════════
    class SyncConfidenceManager {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.syncConfidence = "synced";
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.syncConfidence = "synced";

            self.eventBus.on("DRIFT_LOOP_DETECTED", function() {
                self.setConfidence("unstable");
            });
            self.eventBus.on("SOCKET_DISCONNECTED", function() {
                self.setConfidence("recovering");
            });
            self.eventBus.on("SOCKET_CONNECTED", function() {
                self.setConfidence("stabilizing");
            });
        }

        onStop() {
            this.syncConfidence = "synced";
        }

        setConfidence(level) {
            if (this.syncConfidence === level) return;
            var oldLevel = this.syncConfidence;
            this.syncConfidence = level;
            console.log("[SyncConfidence] State: " + oldLevel + " -> " + level);
            if (this.eventBus) {
                this.eventBus.emit("SYNC_CONFIDENCE_CHANGED", { confidence: level });
            }
        }

        getConfidence() {
            return this.syncConfidence;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SYNC: SnapshotManager
    // ═══════════════════════════════════════════════════════════════════════
    class SnapshotManager {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.lastSnapshot = null;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.lastSnapshot = null;
            
            self.eventBus.on("REMOTE_SYNC_RECEIVED", function(payload) {
                self.lastSnapshot = payload;
                self.eventBus.emit("SNAPSHOT_UPDATED", self.lastSnapshot);
            });

            self.eventBus.on("LOCAL_SYNC_BROADCASTED", function(payload) {
                self.lastSnapshot = payload;
                self.eventBus.emit("SNAPSHOT_UPDATED", self.lastSnapshot);
            });
        }

        onStop() {
            this.lastSnapshot = null;
        }

        getSnapshot() {
            return this.lastSnapshot;
        }

        restore(adapter) {
            if (!this.lastSnapshot || !adapter) return false;
            
            var snapshot = this.lastSnapshot;
            var elapsed = (Date.now() - snapshot.ts) / 1000;
            var targetTime = snapshot.currentTime + (snapshot.playing ? elapsed : 0);

            console.log("[SnapshotManager] Restoring state from cached snapshot: seek to " + targetTime.toFixed(1) + "s, playing=" + snapshot.playing);
            
            adapter.seek(targetTime);
            if (snapshot.playing) {
                adapter.play();
            } else {
                adapter.pause();
            }
            
            this.eventBus.emit("SNAPSHOT_RESTORED", { targetTime: targetTime, playing: snapshot.playing });
            return true;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SYNC: DriftController
    // ═══════════════════════════════════════════════════════════════════════
    class DriftController {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.maxDriftSeconds = 1.5;
            this.hardSeekTimestamps = [];
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.maxDriftSeconds = 1.5;
            self.hardSeekTimestamps = [];

            self.eventBus.on("SYNC_CONFIDENCE_CHANGED", function(data) {
                if (data.confidence === "unstable") {
                    self.maxDriftSeconds = 5.0;
                } else {
                    self.maxDriftSeconds = 1.5;
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
            var difference = this.calculateDrift(localSeconds, targetSeconds);
            var absDiff = Math.abs(difference);

            if (absDiff > this.maxDriftSeconds) {
                console.log("[DriftController] Hard drift exceeded limit (" + absDiff.toFixed(2) + "s). Seeking to " + targetSeconds.toFixed(1) + "s");
                console.log("[VAILISM SYNC] Applying SEEK", { targetTime: targetSeconds, difference: difference });
                this.recordHardSeek(difference);
                adapter.seek(targetSeconds);
                adapter.setPlaybackRate(1.0);
                this.eventBus.emit("DRIFT_SEEK_EXECUTED", { targetTime: targetSeconds, difference: difference });
                return "stabilizing";
            } else if (absDiff > 0.25) {
                var rate = difference > 0 ? 0.97 : 1.03;
                adapter.setPlaybackRate(rate);
                this.eventBus.emit("DRIFT_RATE_ADJUSTED", { rate: rate, difference: difference });
                return "stabilizing";
            } else {
                adapter.setPlaybackRate(1.0);
                return "synced";
            }
        }

        recordHardSeek(difference) {
            this.hardSeekTimestamps.push(Date.now());
            this.hardSeekTimestamps = this.hardSeekTimestamps.filter(function(t) { return Date.now() - t < 30000; });
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

    // ═══════════════════════════════════════════════════════════════════════
    // SYNC: HeartbeatManager
    // ═══════════════════════════════════════════════════════════════════════
    class HeartbeatManager {
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
            var self = this;
            self.lastHeartbeatTime = Date.now();
            
            self.eventBus.on("REMOTE_SYNC_RECEIVED", function(payload) {
                console.log('[VAILISM HEARTBEAT] Received host heartbeat', payload);
                self.lastHeartbeatTime = Date.now();
            });

            self.eventBus.on("VISIBILITY_CHANGED", function(data) {
                var socket = self.kernel.get("socket");
                if (socket && socket.isHost && self.heartbeatInterval) {
                    var syncEngine = self.kernel.get("sync");
                    if (data.state === 'hidden') {
                        self.startSending(syncEngine, 5000);
                    } else {
                        self.startSending(syncEngine, 2500);
                    }
                }
            });
        }

        onStop() {
            this.stopSending();
        }

        startSending(syncEngine, intervalMs) {
            var self = this;
            intervalMs = intervalMs || 2500;
            self.stopSending();
            self.heartbeatInterval = setInterval(function() {
                try {
                    var socket = self.kernel.get("socket");
                    if (!socket || !socket.isConnected() || !socket.isHost) return;

                    syncEngine.getSyncSnapshot().then(function(snapshot) {
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
                        self.eventBus.emit("HEARTBEAT_SENT", {
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

        checkStaleAge(limitMs) {
            limitMs = limitMs || 15000;
            var socket = this.kernel.get("socket");
            if (!socket || !socket.isConnected() || socket.isHost) return false;
            
            var age = Date.now() - this.lastHeartbeatTime;
            if (age > limitMs) {
                this.eventBus.emit("HEARTBEAT_STALE", { age: age });
                return true;
            }
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SYNC: SyncEngine
    // ═══════════════════════════════════════════════════════════════════════
    class SyncEngine {
        constructor(playerWrapper) {
            this.kernel = null;
            this.eventBus = null;
            this.wrapper = playerWrapper || document.getElementById('player-wrap');
            this.isSyncingLocal = false;
            this.isPlaying = false;
            this.seekDebounceTimeout = null;
            this.isJoinBuffered = true;
            this.pendingHostPayload = null;
            this.lastLocalTime = 0;
            this.lastTimeProgression = Date.now();
            this.lastPlaybackEvent = null;
            this.lastProviderCommand = null;
            this.lastSyncTimestamp = 0;
            this.lastHostTime = 0;
            this.lastHostPlaying = false;
            this.adapter = null;
            this.adapterIframe = null;
            this.adapterSrc = '';
            this.providerCapabilities = {
                supportsCommands: false,
                supportsTelemetry: false,
                supportsSeeking: false,
                supportsPlaybackRate: false
            };
            this.telemetrySource = 'none';
            this.pollingActive = false;
            this.syntheticClockEnabled = false;
            this.softSyncMode = false;
            this.lastTelemetryTimestamp = 0;
            this.lastSnapshotBroadcast = 0;
            this.periodicSnapshotIntervalMs = 2500;
            this.maxDriftSeconds = 0.75;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            const socket = this.kernel.get("socket");
            this.isJoinBuffered = !socket.isHost;
            this.pendingHostPayload = null;
            this.isSyncingLocal = false;
            this.isPlaying = false;
            this.lastLocalTime = 0;
            this.lastTimeProgression = Date.now();
            this.lastSnapshotBroadcast = 0;

            this.refreshAdapter(true);

            this.eventBus.on("REMOTE_SYNC_RECEIVED", (payload) => {
                this.handleRemoteSync(payload);
            });

            const heartbeats = this.kernel.get("sync.heartbeats");
            if (socket.isHost) {
                heartbeats.startSending(this);
            }

            if (this.isJoinBuffered) {
                this.eventBus.emit("JOIN_BUFFER_START", { statusText: "Syncing playback..." });
            }

            this.eventBus.on("VISIBILITY_CHANGED", (data) => {
                const adapter = this.getAdapter();
                if (adapter && typeof adapter.resetPollingInterval === 'function') {
                    adapter.resetPollingInterval();
                }

                if (data.state === 'visible') {
                    const socket = this.kernel.get("socket");
                    if (socket && !socket.isHost && socket.isConnected()) {
                        console.log("[SyncEngine] Tab visible. Requesting latest room snapshot...");
                        const confidenceManager = this.kernel.get("sync.confidence");
                        confidenceManager.setConfidence("recovering");

                        const reconnectManager = this.kernel.get("recovery.reconnect");
                        socket.joinRoom(reconnectManager.roomId, reconnectManager.username, (res) => {
                            if (res && res.lastSync) {
                                this.handleRemoteSync(res.lastSync);
                            }
                        });
                    }
                }
            });
        }

        onStop() {
            if (this.seekDebounceTimeout) clearTimeout(this.seekDebounceTimeout);
            const heartbeats = this.kernel.get("sync.heartbeats");
            heartbeats.stopSending();
            if (this.adapter && typeof this.adapter.stopPolling === 'function') {
                this.adapter.stopPolling();
            }
        }

        refreshAdapter(force = false) {
            const previousAdapter = this.adapter;
            const adapter = this.getAdapter(force);
            if (previousAdapter && previousAdapter !== adapter && typeof previousAdapter.stopPolling === 'function') {
                previousAdapter.stopPolling();
            }

            if (adapter) {
                const capabilities = typeof adapter.getCapabilities === 'function'
                    ? adapter.getCapabilities()
                    : {
                        supportsCommands: false,
                        supportsTelemetry: false,
                        supportsSeeking: false,
                        supportsPlaybackRate: false
                    };
                this.providerCapabilities = capabilities;
                this.softSyncMode = !capabilities.supportsTelemetry;

                if (typeof adapter.setTelemetryListener === 'function') {
                    adapter.setTelemetryListener((snapshot) => {
                        this.handleProviderTelemetry(snapshot);
                    });
                }
                if (typeof adapter.startPolling === 'function') {
                    adapter.startPolling();
                }

                this.pollingActive = !!adapter.pollingActive;
                this.eventBus.emit('PROVIDER_CAPABILITIES_UPDATED', {
                    adapter: adapter.constructor.name,
                    capabilities,
                    softSyncMode: this.softSyncMode
                });
                console.log('[VAILISM PROVIDER] Adapter ready', {
                    adapter: adapter.constructor.name,
                    capabilities,
                    softSyncMode: this.softSyncMode
                });
            }

            return adapter;
        }

        getAdapter(force = false) {
            if (!this.wrapper) return null;
            const iframe = this.wrapper.querySelector("iframe");
            if (!iframe) return null;
            const src = iframe.src || "";

            if (!force && this.adapter && this.adapterIframe === iframe && this.adapterSrc === src) {
                return this.adapter;
            }

            let nextAdapter = null;
            if (src.includes("vidlink.pro")) {
                nextAdapter = new VidlinkAdapter(iframe);
            } else if (src.includes("vidsrc.to")) {
                nextAdapter = new VidsrcAdapter(iframe);
            } else if (src.includes("videasy.net")) {
                nextAdapter = new VideasyAdapter(iframe);
            } else {
                nextAdapter = new GenericIframeAdapter(iframe);
            }

            this.adapter = nextAdapter;
            this.adapterIframe = iframe;
            this.adapterSrc = src;

            if (nextAdapter && this.eventBus) {
                if (typeof nextAdapter.setTelemetryListener === 'function') {
                    nextAdapter.setTelemetryListener((snapshot) => {
                        this.handleProviderTelemetry(snapshot);
                    });
                }
                if (typeof nextAdapter.startPolling === 'function') {
                    nextAdapter.startPolling();
                }
                if (typeof nextAdapter.getCapabilities === 'function') {
                    this.providerCapabilities = nextAdapter.getCapabilities();
                    this.softSyncMode = !this.providerCapabilities.supportsTelemetry;
                }
                this.pollingActive = !!nextAdapter.pollingActive;
            }

            return nextAdapter;
        }

        getTelemetryStatus() {
            return {
                source: this.telemetrySource,
                pollingActive: this.pollingActive,
                syntheticClockEnabled: this.syntheticClockEnabled,
                capabilities: { ...this.providerCapabilities },
                softSyncMode: this.softSyncMode,
                lastTelemetryAgeMs: this.lastTelemetryTimestamp ? Date.now() - this.lastTelemetryTimestamp : null
            };
        }

        getSyncSnapshot() {
            const adapter = this.getAdapter();
            const state = adapter && typeof adapter.getStateSnapshot === 'function'
                ? adapter.getStateSnapshot()
                : null;

            if (state && Number.isFinite(state.currentTime)) {
                return Promise.resolve({
                    currentTime: state.currentTime,
                    playing: typeof state.playing === 'boolean' ? state.playing : !state.paused,
                    paused: typeof state.paused === 'boolean' ? state.paused : !state.playing,
                    buffering: !!state.buffering,
                    playbackRate: Number.isFinite(state.playbackRate) ? state.playbackRate : 1.0,
                    duration: Number.isFinite(state.duration) ? state.duration : 0,
                    source: state.source || this.telemetrySource || 'adapter-state',
                    synthetic: !!state.synthetic,
                    ts: Date.now()
                });
            }

            return this.getPlayerTime().then((currentTime) => ({
                currentTime: Number.isFinite(currentTime) ? currentTime : 0,
                playing: this.isPlaying,
                paused: !this.isPlaying,
                buffering: false,
                playbackRate: 1.0,
                duration: 0,
                source: 'iframe-query',
                synthetic: false,
                ts: Date.now()
            }));
        }

        getAdapterType() {
            const adapter = this.getAdapter();
            return adapter ? adapter.constructor.name : 'None';
        }

        recordProviderCommand(command, success, details) {
            this.lastProviderCommand = {
                command: command,
                success: success,
                adapter: this.getAdapterType(),
                ts: Date.now()
            };
            details = details || {};
            for (var key in details) this.lastProviderCommand[key] = details[key];
            this.eventBus.emit("PROVIDER_COMMAND_ATTEMPTED", this.lastProviderCommand);
        }

        sendProviderCommand(adapter, command, details = {}) {
            if (!adapter || typeof adapter.sendCommand !== 'function') {
                this.recordProviderCommand(command, false, { reason: 'adapter-missing' });
                return false;
            }

            var success = adapter.sendCommand(command, details);
            this.recordProviderCommand(command, success, details);
            return success;
        }

        normalizeMessage(payload) {
            const adapter = this.getAdapter();
            return adapter ? adapter.normalizeMessage(payload) : null;
        }

        maybeBroadcastSnapshot(snapshot) {
            const socket = this.kernel.get('socket');
            if (!socket || !socket.isHost || !socket.isConnected()) return;

            const now = Date.now();
            if (now - this.lastSnapshotBroadcast < this.periodicSnapshotIntervalMs) return;

            this.lastSnapshotBroadcast = now;
            socket.emitSyncEvent({
                currentTime: snapshot.currentTime,
                playing: !!snapshot.playing,
                paused: !!snapshot.paused,
                buffering: !!snapshot.buffering,
                playbackRate: Number.isFinite(snapshot.playbackRate) ? snapshot.playbackRate : 1.0,
                duration: Number.isFinite(snapshot.duration) ? snapshot.duration : 0,
                telemetrySource: snapshot.source || this.telemetrySource,
                synthetic: !!snapshot.synthetic,
                ts: now
            });

            this.eventBus.emit('LOCAL_SYNC_BROADCASTED', {
                action: 'SNAPSHOT',
                currentTime: snapshot.currentTime,
                playing: !!snapshot.playing,
                source: snapshot.source || this.telemetrySource,
                synthetic: !!snapshot.synthetic,
                ts: now
            });
            console.log('[VAILISM HEARTBEAT] Broadcast periodic snapshot', {
                currentTime: snapshot.currentTime,
                playing: !!snapshot.playing,
                source: snapshot.source || this.telemetrySource,
                synthetic: !!snapshot.synthetic
            });
        }

        handleProviderTelemetry(snapshot) {
            if (!snapshot || typeof snapshot !== 'object') return;

            const adapter = this.getAdapter();
            if (adapter && typeof adapter.getCapabilities === 'function') {
                this.providerCapabilities = adapter.getCapabilities();
                this.softSyncMode = !this.providerCapabilities.supportsTelemetry;
                this.pollingActive = !!adapter.pollingActive;
                this.syntheticClockEnabled = !!adapter.syntheticClockEnabled;
            }

            this.telemetrySource = snapshot.source || (snapshot.synthetic ? 'synthetic-clock' : 'provider-telemetry');
            this.lastTelemetryTimestamp = Date.now();
            if (Number.isFinite(snapshot.currentTime)) {
                this.lastLocalTime = snapshot.currentTime;
            }
            if (typeof snapshot.playing === 'boolean') {
                this.isPlaying = snapshot.playing;
            } else if (typeof snapshot.paused === 'boolean') {
                this.isPlaying = !snapshot.paused;
            }

            this.eventBus.emit('PROVIDER_TELEMETRY_UPDATED', {
                ...snapshot,
                source: this.telemetrySource,
                capabilities: { ...this.providerCapabilities },
                pollingActive: this.pollingActive,
                syntheticClockEnabled: this.syntheticClockEnabled,
                softSyncMode: this.softSyncMode,
                ts: this.lastTelemetryTimestamp
            });
            console.log('[VAILISM TELEMETRY] Provider snapshot', {
                type: snapshot.type,
                currentTime: snapshot.currentTime,
                paused: snapshot.paused,
                playbackRate: snapshot.playbackRate,
                source: this.telemetrySource,
                synthetic: !!snapshot.synthetic
            });

            const evtName = snapshot.type || 'timeupdate';
            this.handleLocalPlayerEvent(evtName, snapshot.currentTime || 0, snapshot.duration || 0, snapshot);
            this.maybeBroadcastSnapshot(snapshot);
        }

        getPlayerTime() {
            const iframe = this.wrapper ? this.wrapper.querySelector("iframe") : null;
            return new Promise((resolve) => {
                try {
                    if (!iframe || !iframe.contentWindow) return resolve(0);
                    const channel = new MessageChannel();
                    channel.port1.onmessage = (event) => {
                        try {
                            var data = event.data;
                            if (typeof data === "string") {
                                try { data = JSON.parse(data); } catch(ex) {}
                            }
                            if (data && data.data) data = data.data;
                            resolve(data.currentTime !== undefined ? data.currentTime : (data.time !== undefined ? data.time : 0));
                        } catch (err) {
                            resolve(0);
                        }
                    };
                    iframe.contentWindow.postMessage(
                        JSON.stringify({ command: "getCurrentTime" }),
                        "*",
                        [channel.port2]
                    );
                    setTimeout(() => { resolve(0); }, 120);
                } catch (e) {
                    resolve(0);
                }
            });
        }

        handleRemoteSync(payload) {
            var self = this;
            var socket = self.kernel.get("socket");
            if (socket.isHost) return;

            var action = payload.action;
            var currentTime = payload.currentTime;
            var playing = payload.playing;
            var ts = payload.ts;

            self.lastPlaybackEvent = { source: 'remote', action: action, currentTime: currentTime, playing: playing, ts: ts };
            self.lastSyncTimestamp = Date.now();
            console.log('[VAILISM SYNC] Received ' + String(action || 'SYNC').toUpperCase(), payload);

            self.lastHostTime = currentTime;
            self.lastHostPlaying = playing;
            
            if (self.isJoinBuffered) {
                self.pendingHostPayload = payload;
                self.eventBus.emit("JOIN_BUFFER_PROGRESS", { statusText: "Buffering stream..." });
                return;
            }

            self.isSyncingLocal = true;
            var networkLag = (Date.now() - ts) / 1000;
            var targetTime = currentTime + (playing ? networkLag : 0);

            console.log("[SyncEngine] Remote sync: " + action + " at " + targetTime.toFixed(1) + "s (lag=" + networkLag.toFixed(2) + "s)");

            var adapter = self.getAdapter();
            if (adapter) {
                if (playing !== self.isPlaying) {
                    self.isPlaying = playing;
                    var fsm = self.kernel.get("fsm");
                    fsm.transitionTo(playing ? 'PLAYING' : 'PAUSED', "Remote command: " + action);
                    if (playing) {
                        self.sendProviderCommand(adapter, 'play', { reason: 'remote-sync' });
                    } else {
                        self.sendProviderCommand(adapter, 'pause', { reason: 'remote-sync' });
                    }
                }
                
                var drift = self.kernel.get("sync.drift");
                self.getPlayerTime().then(function(localSeconds) {
                    var confidence = drift.adjustPlayback(localSeconds, targetTime, adapter, playing);
                    var confidenceManager = self.kernel.get("sync.confidence");
                    if (confidenceManager.getConfidence() !== "unstable") {
                        confidenceManager.setConfidence(confidence);
                    }
                });
            }

            setTimeout(function() {
                self.isSyncingLocal = false;
            }, 500);
        }

        handleLocalPlayerEvent(evtName, currentTime, duration, normalized) {
            var self = this;
            self.eventBus.emit("PLAYER_EVENT_RECEIVED", { evtName: evtName, currentTime: currentTime, duration: duration });

            if (self.isJoinBuffered) {
                if (evtName === 'ready' || (evtName === 'timeupdate' && currentTime > 0)) {
                    console.log("[SyncEngine] Guest stream ready. Completing join sync...");
                    self.isJoinBuffered = false;
                    self.eventBus.emit("JOIN_BUFFER_COMPLETE");
                    
                    if (self.pendingHostPayload) {
                        var payload = self.pendingHostPayload;
                        self.pendingHostPayload = null;
                        
                        var networkLag = (Date.now() - payload.ts) / 1000;
                        var targetTime = payload.currentTime + (payload.playing ? networkLag : 0);
                        
                        self.isSyncingLocal = true;
                        var adapter = self.getAdapter();
                        if (adapter) {
                            self.sendProviderCommand(adapter, 'seek', { time: targetTime, reason: 'join-sync' });
                            var fsm = self.kernel.get("fsm");
                            if (payload.playing) {
                                self.isPlaying = true;
                                fsm.transitionTo('PLAYING', 'Aligned with host playing on join');
                                self.sendProviderCommand(adapter, 'play', { reason: 'join-sync' });
                            } else {
                                self.isPlaying = false;
                                fsm.transitionTo('PAUSED', 'Aligned with host paused on join');
                                self.sendProviderCommand(adapter, 'pause', { reason: 'join-sync' });
                            }
                        }
                        
                        setTimeout(function() {
                            self.isSyncingLocal = false;
                            var confidenceManager = self.kernel.get("sync.confidence");
                            confidenceManager.setConfidence("synced");
                        }, 500);
                    } else {
                        var fsm = self.kernel.get("fsm");
                        fsm.transitionTo(self.isPlaying ? 'PLAYING' : 'PAUSED', 'No pending host payload on join');
                        var confidenceManager = self.kernel.get("sync.confidence");
                        confidenceManager.setConfidence("synced");
                    }
                }
                return;
            }

            var fsm = self.kernel.get("fsm");
            if (fsm.currentState === 'SYNCING' && evtName === 'timeupdate') {
                fsm.transitionTo(self.isPlaying ? 'PLAYING' : 'PAUSED', 'Resumed playhead progression after seek');
            }

            var socket = self.kernel.get("socket");
            if (!socket.isHost && evtName === 'timeupdate') {
                var adapter = self.getAdapter();
                var drift = self.kernel.get("sync.drift");
                self.eventBus.emit("LOCAL_PLAYER_TIME_UPDATE", { currentTime: currentTime });
                if (adapter) {
                    var elapsed = (Date.now() - self.kernel.get("sync.heartbeats").lastHeartbeatTime) / 1000;
                    var snapshots = self.kernel.get("sync.snapshots");
                    var snapshot = snapshots.getSnapshot();
                    if (snapshot) {
                        var hostTime = snapshot.currentTime + (snapshot.playing ? elapsed : 0);
                        var confidence = drift.adjustPlayback(currentTime, hostTime, adapter, snapshot.playing);
                        var confidenceManager = self.kernel.get("sync.confidence");
                        if (confidenceManager.getConfidence() !== "unstable") {
                            confidenceManager.setConfidence(confidence);
                        }
                    }
                }
                return;
            }

            if (!socket.isHost || self.isSyncingLocal) return;
            if (evtName === 'timeupdate') return;

            console.log("[SyncEngine] Local Host Event: " + evtName + " at " + currentTime.toFixed(1) + "s");
            console.log('[VAILISM SYNC] Emitting ' + String(evtName).toUpperCase(), { currentTime: currentTime, duration: duration, normalized: normalized });
            var adapter = self.getAdapter();
            self.lastPlaybackEvent = { source: 'local', event: evtName, currentTime: currentTime, duration: duration, normalized: normalized, ts: Date.now() };
            self.lastSyncTimestamp = Date.now();

            if (evtName === "play") {
                self.isPlaying = true;
                fsm.transitionTo('PLAYING', 'Host local play event');
                socket.emitSyncEvent({
                    currentTime: currentTime,
                    playing: true,
                    paused: false,
                    buffering: false,
                    playbackRate: 1.0,
                    ts: Date.now()
                });
                self.eventBus.emit("SYNC_EVENT_EMITTED", { action: "PLAY", currentTime: currentTime, playing: true, ts: Date.now() });
                self.eventBus.emit("LOCAL_SYNC_BROADCASTED", { action: "PLAY", currentTime: currentTime, playing: true, ts: Date.now() });
            } else if (evtName === "pause") {
                self.isPlaying = false;
                fsm.transitionTo('PAUSED', 'Host local pause event');
                socket.emitSyncEvent({
                    currentTime: currentTime,
                    playing: false,
                    paused: true,
                    buffering: false,
                    playbackRate: 1.0,
                    ts: Date.now()
                });
                self.eventBus.emit("SYNC_EVENT_EMITTED", { action: "PAUSE", currentTime: currentTime, playing: false, ts: Date.now() });
                self.eventBus.emit("LOCAL_SYNC_BROADCASTED", { action: "PAUSE", currentTime: currentTime, playing: false, ts: Date.now() });
            } else if (evtName === "seek" || evtName === "seeked") {
                fsm.transitionTo('SYNCING', 'Host local seek event');
                if (self.seekDebounceTimeout) clearTimeout(self.seekDebounceTimeout);
                self.seekDebounceTimeout = setTimeout(function() {
                    socket.emitSyncEvent({
                        currentTime: currentTime,
                        playing: self.isPlaying,
                        paused: !self.isPlaying,
                        buffering: false,
                        playbackRate: 1.0,
                        ts: Date.now()
                    });
                    self.eventBus.emit("SYNC_EVENT_EMITTED", { action: "SEEK", currentTime: currentTime, playing: self.isPlaying, ts: Date.now() });
                    self.eventBus.emit("LOCAL_SYNC_BROADCASTED", { action: "SEEK", currentTime: currentTime, playing: self.isPlaying, ts: Date.now() });
                    fsm.transitionTo(self.isPlaying ? 'PLAYING' : 'PAUSED', 'Resumed after local seek broadcast');
                }, 250);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RECOVERY: Watchdog
    // ═══════════════════════════════════════════════════════════════════════
    class Watchdog {
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
            var self = this;
            self.lastLocalTime = 0;
            self.lastTimeProgression = Date.now();

            self.eventBus.on("LOCAL_PLAYER_TIME_UPDATE", function(data) {
                if (data.currentTime !== self.lastLocalTime) {
                    self.lastLocalTime = data.currentTime;
                    self.lastTimeProgression = Date.now();
                    self.eventBus.emit("WATCHDOG_PLAYHEAD_PROGRESS", { currentTime: data.currentTime });
                }
            });

            self.eventBus.on("FSM_TRANSITION", function(data) {
                if (data.currentState === "PLAYING") {
                    self.lastTimeProgression = Date.now();
                }
            });

            self.watchdogInterval = setInterval(function() {
                try {
                    if (document.visibilityState === 'hidden') return;
                    var syncEngine = self.kernel.get("sync");
                    if (!syncEngine || !syncEngine.isPlaying || syncEngine.isJoinBuffered) return;

                    syncEngine.getPlayerTime().then(function(currentTime) {
                        if (currentTime === self.lastLocalTime) {
                            var timeSinceProgress = Date.now() - self.lastTimeProgression;
                            if (timeSinceProgress > 4000) {
                                console.warn("[Watchdog] Playhead frozen for " + Math.round(timeSinceProgress / 1000) + "s.");
                                self.eventBus.emit("WATCHDOG_STALL_DETECTED", {
                                    currentTime: currentTime,
                                    duration: timeSinceProgress
                                });
                            }
                        } else {
                            self.lastLocalTime = currentTime;
                            self.lastTimeProgression = Date.now();
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

    // ═══════════════════════════════════════════════════════════════════════
    // RECOVERY: ReconnectManager
    // ═══════════════════════════════════════════════════════════════════════
    class ReconnectManager {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.reconnectInterval = null;
            this.reconnectCountdown = 5;
            this.roomId = null;
            this.username = null;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.eventBus.on("SOCKET_DISCONNECTED", function() {
                self.startCountdown();
            });
            self.eventBus.on("SOCKET_CONNECTED", function() {
                self.stopCountdown();
            });
        }

        onStop() {
            this.stopCountdown();
        }

        setRoomContext(roomId, username) {
            this.roomId = roomId;
            this.username = username;
        }

        startCountdown() {
            var self = this;
            self.stopCountdown();
            self.reconnectCountdown = 5;
            
            self.reconnectInterval = setInterval(function() {
                try {
                    self.reconnectCountdown--;
                    self.eventBus.emit("RECONNECT_COUNTDOWN_TICK", { countdown: self.reconnectCountdown });
                    
                    if (self.reconnectCountdown <= 0) {
                        self.reconnectCountdown = 5;
                        self.eventBus.emit("RECONNECT_ATTEMPT_TRIGGERED");
                    }
                } catch (err) {
                    console.error("[ReconnectManager] Error in countdown interval:", err);
                }
            }, 1000);
        }

        stopCountdown() {
            if (this.reconnectInterval) {
                clearInterval(this.reconnectInterval);
                this.reconnectInterval = null;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // RECOVERY: RecoveryManager
    // ═══════════════════════════════════════════════════════════════════════
    class RecoveryManager {
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
            var self = this;
            self.retryCount = 0;
            self.reloadAttempts = 0;

            self.eventBus.on("WATCHDOG_STALL_DETECTED", function(data) {
                self.handleStallRecovery(data.currentTime);
            });

            self.eventBus.on("PROVIDER_HEALTH_DEGRADED", function(data) {
                if (data.reason === "freeze") {
                    self.handleStallRecovery(data.currentTime || 0);
                } else if (data.reason === "silence" && self.reloadAttempts < 2) {
                    self.triggerIframeReload();
                }
            });
        }

        onStop() {
            this.retryCount = 0;
            this.reloadAttempts = 0;
        }

        handleStallRecovery(currentTime) {
            var self = this;
            var syncEngine = self.kernel.get("sync");
            var metrics = self.kernel.get("metrics");
            
            metrics.increment("stallsCount");

            if (self.retryCount < 3) {
                self.retryCount++;
                metrics.increment("recoveryAttempts");
                console.log("[RecoveryManager] Playback stalled. Recovery seek retry #" + self.retryCount + "...");
                
                var adapter = syncEngine.getAdapter();
                if (adapter) {
                    adapter.seek(currentTime);
                    adapter.play();
                }
            } else {
                if (self.reloadAttempts < 2) {
                    self.triggerIframeReload();
                } else {
                    console.error("[RecoveryManager] Recovery and reload retries completely exhausted.");
                    var fsm = self.kernel.get("fsm");
                    fsm.transitionTo("FAILED", "Autoplay blocked or stream crashed permanently");
                    self.eventBus.emit("RECOVERY_EXHAUSTED");
                }
            }
        }

        triggerIframeReload() {
            var self = this;
            var syncEngine = self.kernel.get("sync");
            var fsm = self.kernel.get("fsm");
            var metrics = self.kernel.get("metrics");

            self.reloadAttempts++;
            metrics.increment("providerReloads");
            fsm.transitionTo("RECOVERING", "RecoveryManager reloading iframe (Attempt #" + self.reloadAttempts + ")");

            var adapter = syncEngine.getAdapter();
            if (!adapter || !adapter.iframe) return;

            console.warn("[RecoveryManager] Reloading iframe due to persistent stall. Reload attempt #" + self.reloadAttempts);
            self.eventBus.emit("RECOVERY_RELOAD_STARTING", { attempt: self.reloadAttempts });

            var originalSrc = adapter.iframe.src;
            adapter.iframe.src = "about:blank";
            
            setTimeout(function() {
                try {
                    adapter.iframe.src = originalSrc;
                    syncEngine.isJoinBuffered = true;
                    var snapshots = self.kernel.get("sync.snapshots");
                    syncEngine.pendingHostPayload = snapshots.getSnapshot() || {
                        action: syncEngine.isPlaying ? "PLAY" : "PAUSE",
                        currentTime: syncEngine.lastLocalTime,
                        playing: syncEngine.isPlaying,
                        ts: Date.now()
                    };
                    
                    self.retryCount = 0;
                    syncEngine.lastTimeProgression = Date.now();
                    self.eventBus.emit("RECOVERY_RELOAD_COMPLETED");
                } catch (err) {
                    console.error("[RecoveryManager] Error resetting iframe source reload:", err);
                }
            }, 200);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UI: ToastManager
    // ═══════════════════════════════════════════════════════════════════════
    class ToastManager {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.eventBus.on("SHOW_TOAST", function(data) { self.show(data.message); });
            self.eventBus.on("SOCKET_CONNECTED", function() { self.show("Connected to sync server"); });
            self.eventBus.on("SOCKET_DISCONNECTED", function() { self.show("Disconnected. Reconnecting..."); });
        }

        onStop() {}

        show(msg) {
            var failureIsolation = this.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.toast", "showToast", function() {
                var container = document.getElementById("partyToastContainer");
                if (!container) return;
                var toast = document.createElement("div");
                toast.className = "party-toast";
                toast.textContent = msg;
                container.appendChild(toast);
                
                setTimeout(function() {
                    try {
                        if (toast.parentNode) {
                            toast.parentNode.removeChild(toast);
                        }
                    } catch (err) {
                        console.error("[ToastManager] Error removing toast:", err);
                    }
                }, 3000);
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UI: StatusRenderer
    // ═══════════════════════════════════════════════════════════════════════
    class StatusRenderer {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.escapeHTML = window.escapeHTML || function(str) { return String(str).replace(/[&<>'"]/g, function(m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[m]; }); };
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.eventBus.on("FSM_TRANSITION", function() {
                self.updateStatusUI();
                self.updateConnectionQualityBadge();
            });
            self.eventBus.on("SOCKET_CONNECTED", function() {
                self.updateStatusUI();
                self.updateConnectionQualityBadge();
            });
            self.eventBus.on("ROOM_CREATED", function() {
                self.updateStatusUI();
            });
            self.eventBus.on("ROOM_JOINED", function() {
                self.updateStatusUI();
            });
            self.eventBus.on("PRESENCE_UPDATED", function() {
                self.updateStatusUI();
            });
            self.eventBus.on("REMOTE_SYNC_RECEIVED", function() {
                self.updateStatusUI();
            });
            self.eventBus.on("SYNC_EVENT_EMITTED", function() {
                self.updateStatusUI();
            });
            self.eventBus.on("SYNC_CONFIDENCE_CHANGED", function() {
                self.updateStatusUI();
                self.updateConnectionQualityBadge();
            });
            self.eventBus.on("RTT_MEASURED", function() {
                self.updateConnectionQualityBadge();
            });
            self.eventBus.on("SOCKET_DISCONNECTED", function() {
                self.updateConnectionQualityBadge("disconnected");
            });
            self.eventBus.on("SOCKET_CONNECT_ERROR", function() {
                self.updateConnectionQualityBadge("error");
            });
            self.eventBus.on("SOCKET_CONNECT_INITIATED", function() {
                self.updateConnectionQualityBadge("connecting");
            });
        }

        onStop() {}

        updateStatusUI(text, stateClass) {
            var self = this;
            var failureIsolation = self.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.status", "updateStatusUI", function() {
                var container = document.getElementById("jaas-chat-iframe-container");
                if (!container) return;

                var displayStatus = text;
                var stateDotClass = stateClass;

                var fsm = self.kernel.get("fsm");
                var fsmState = fsm ? fsm.currentState : "IDLE";
                var socket = self.kernel.get("socket");
                var isHost = socket ? socket.isHost : false;
                var roomManager = self.kernel.get("recovery.reconnect");
                var roomId = roomManager ? roomManager.roomId : null;
                var presence = self.kernel.get("network.presence");
                var hostId = presence ? presence.hostId : null;
                var socketId = socket ? socket.getSocketId() : null;
                var confidenceManager = self.kernel.get("sync.confidence");
                var confidence = confidenceManager ? confidenceManager.getConfidence() : "synced";
                var syncEngine = self.kernel.get("sync");
                
                var stateMapping = {
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
                    } else if (isHost || hostId === socketId) {
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

                if (confidence === "stabilizing" && (fsmState === "PLAYING" || fsmState === "PAUSED" || fsmState === "SYNCING")) {
                    displayStatus = "Sync Stabilizing";
                    stateDotClass = "connecting";
                } else if (confidence === "delayed") {
                    displayStatus = "Playback Stalled";
                    stateDotClass = "error";
                } else if (confidence === "unstable") {
                    displayStatus = "Sync Degrading";
                    stateDotClass = "connecting";
                }

                container.innerHTML =
                    '<div class="party-status-card ' + (stateDotClass || 'connected') + '">' +
                    '<div class="party-status-dot"></div>' +
                    '<div class="party-status-details">' +
                    '<span class="party-status-label">Room Status</span>' +
                    '<span class="party-status-value">' + (displayStatus || 'Synced') + '</span>' +
                    '</div></div>';
            });
        }

        updateConnectionQualityBadge(state) {
            var self = this;
            var failureIsolation = self.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.status", "updateConnectionQualityBadge", function() {
                var badge = document.getElementById("partyConnectionBadge");
                if (!badge) return;

                badge.className = "party-badge";
                var statusText = "Connected";
                var stateClass = "connected";

                var socket = self.kernel.get("socket");
                var isHost = socket ? socket.isHost : false;
                var monitor = self.kernel.get("network.quality");
                var currentRtt = monitor ? monitor.rtt : 0;

                if (state) {
                    stateClass = state;
                    if (state === 'connecting') statusText = 'Connecting to Sync Server...';
                    else if (state === 'reconnecting') statusText = 'Reconnecting to Sync Server...';
                    else if (state === 'disconnected') statusText = 'Disconnected from Server';
                    else if (state === 'error') statusText = 'Sync Connection Error';
                    else if (state === 'host') statusText = 'Connected (Host Controller)';
                } else {
                    var fsm = self.kernel.get("fsm");
                    var fsmState = fsm ? fsm.currentState : "IDLE";
                    var confidenceManager = self.kernel.get("sync.confidence");
                    var confidence = confidenceManager ? confidenceManager.getConfidence() : "synced";
                    
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
                        statusText = "Sync stabilizing... (" + currentRtt + "ms RTT)";
                    } else if (confidence === "delayed") {
                        stateClass = "poor";
                        statusText = "Playback delayed";
                    } else if (confidence === "unstable") {
                        stateClass = "poor";
                        statusText = "Sync unstable (expanded drift tolerance)";
                    } else if (currentRtt > 300) {
                        stateClass = "poor";
                        statusText = "Poor Connection Latency (" + currentRtt + "ms RTT)";
                    } else {
                        stateClass = isHost ? 'host' : 'connected';
                        statusText = "Connected (" + currentRtt + "ms RTT)";
                    }
                }

                badge.classList.add(stateClass);
                badge.title = statusText;
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UI: PresenceRenderer
    // ═══════════════════════════════════════════════════════════════════════
    class PresenceRenderer {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
            this.escapeHTML = window.escapeHTML || function(str) { return String(str).replace(/[&<>'"]/g, function(m) { return ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[m]; }); };
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.eventBus.on("PRESENCE_UPDATED", function(data) {
                self.updateParticipantsListUI(data.participants, data.hostId, data.isHost);
            });
            self.eventBus.on("TYPING_UPDATED", function(data) {
                self.updateTypingIndicatorUI(data.activeTypers);
            });
        }

        onStop() {}

        updateParticipantsListUI(participants, hostId, isHost) {
            var self = this;
            var failureIsolation = self.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.presence", "updateParticipantsListUI", function() {
                var listContainer = document.getElementById("partyParticipantsList");
                var countContainer = document.getElementById("partyUserCount");
                if (!listContainer) return;

                var socket = self.kernel.get("socket");
                var presence = self.kernel.get("network.presence");
                var userName = presence ? presence.username || "You" : "You";

                if (countContainer) {
                    countContainer.textContent = participants.size + 1;
                }

                var fragment = document.createDocumentFragment();
                
                var meRow = document.createElement("div");
                meRow.className = "party-member-row";
                var escapedLocalName = self.escapeHTML(userName);
                var firstCharLocal = self.escapeHTML(userName.charAt(0).toUpperCase());
                meRow.innerHTML =
                    '<div class="party-member-avatar" style="background:#e50914;">' + firstCharLocal + '</div>' +
                    '<div class="party-member-info">' +
                    '<span class="party-member-name">' + escapedLocalName + ' (You) ' + (isHost ? '👑' : '') + '</span>' +
                    '<span class="party-member-role">' + (isHost ? 'Host' : 'Viewer') + '</span>' +
                    '</div>';
                fragment.appendChild(meRow);

                participants.forEach(function(p, sId) {
                    if (socket && sId === socket.getSocketId()) return;
                    var pRow = document.createElement("div");
                    pRow.className = "party-member-row";
                    var isPHost = (sId === hostId);
                    var escapedDisplayName = self.escapeHTML(p.displayName);
                    var firstCharDisplay = self.escapeHTML(p.displayName.charAt(0).toUpperCase());
                    pRow.innerHTML =
                        '<div class="party-member-avatar" style="background:#333;">' + firstCharDisplay + '</div>' +
                        '<div class="party-member-info">' +
                        '<span class="party-member-name">' + escapedDisplayName + ' ' + (isPHost ? '👑' : '') + '</span>' +
                        '<span class="party-member-role">' + (isPHost ? 'Host' : 'Viewer') + '</span>' +
                        '</div>';
                    fragment.appendChild(pRow);
                });

                listContainer.innerHTML = "";
                listContainer.appendChild(fragment);
            });
        }

        updateTypingIndicatorUI(activeTypers) {
            var self = this;
            var failureIsolation = self.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.presence", "updateTypingIndicatorUI", function() {
                var indicator = document.getElementById("partyTypingIndicator");
                if (!indicator) return;

                var typers = activeTypers ? Array.from(activeTypers.values()) : [];
                if (typers.length === 0) {
                    indicator.innerHTML = "";
                } else if (typers.length === 1) {
                    indicator.innerHTML = self.escapeHTML(typers[0].name) + ' is typing<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';
                } else if (typers.length === 2) {
                    indicator.innerHTML = self.escapeHTML(typers[0].name) + ' and ' + self.escapeHTML(typers[1].name) + ' are typing<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';
                } else {
                    indicator.innerHTML = 'Multiple people are typing<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>';
                }
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UI: OverlayManager
    // ═══════════════════════════════════════════════════════════════════════
    class OverlayManager {
        constructor() {
            this.kernel = null;
            this.eventBus = null;
        }

        injectKernel(kernel) {
            this.kernel = kernel;
            this.eventBus = kernel.get("eventBus");
        }

        onStart() {
            var self = this;
            self.eventBus.on("JOIN_BUFFER_START", function(data) { self.showJoinOverlay(data.statusText); });
            self.eventBus.on("JOIN_BUFFER_PROGRESS", function(data) { self.showJoinOverlay(data.statusText); });
            
            self.eventBus.on("JOIN_BUFFER_COMPLETE", function() {
                self.showJoinOverlay("Ready");
                setTimeout(function() { self.hideJoinOverlay(); }, 500);
            });

            self.eventBus.on("RECOVERY_RELOAD_STARTING", function(data) {
                self.showJoinOverlay("Recovering stream (Attempt #" + data.attempt + ")...");
            });

            self.eventBus.on("RECOVERY_RELOAD_COMPLETED", function() {
                self.showJoinOverlay("Ready");
                setTimeout(function() { self.hideJoinOverlay(); }, 500);
            });

            self.eventBus.on("RECOVERY_EXHAUSTED", function() {
                self.showBlockedAutoplayUI();
            });
        }

        onStop() {
            this.hideJoinOverlay();
            this.hideBlockedAutoplayUI();
        }

        showJoinOverlay(statusText) {
            var failureIsolation = this.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.overlay", "showJoinOverlay", function() {
                var overlay = document.getElementById("partyJoinOverlay");
                var textEl = document.getElementById("partyJoinStatusText");
                if (overlay && textEl) {
                    textEl.textContent = statusText;
                    overlay.style.display = "flex";
                    overlay.style.opacity = "1";
                }
            });
        }

        hideJoinOverlay() {
            var failureIsolation = this.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.overlay", "hideJoinOverlay", function() {
                var overlay = document.getElementById("partyJoinOverlay");
                if (overlay) {
                    overlay.style.opacity = "0";
                    setTimeout(function() {
                        try { overlay.style.display = "none"; } catch (e) {}
                    }, 400);
                }
            });
        }

        showBlockedAutoplayUI() {
            var self = this;
            var failureIsolation = self.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.overlay", "showBlockedAutoplayUI", function() {
                var overlay = document.getElementById("partyAutoplayBlockOverlay");
                if (overlay) {
                    overlay.style.display = "flex";
                    var btn = document.getElementById("partyUnblockAutoplayBtn");
                    if (btn) {
                        btn.onclick = function() { self.unblockAutoplay(); };
                    }
                }
            });
        }

        hideBlockedAutoplayUI() {
            var failureIsolation = this.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.overlay", "hideBlockedAutoplayUI", function() {
                var overlay = document.getElementById("partyAutoplayBlockOverlay");
                if (overlay) {
                    overlay.style.display = "none";
                }
            });
        }

        unblockAutoplay() {
            var self = this;
            var failureIsolation = self.kernel.get("recovery.failureIsolation");
            failureIsolation.runSafe("ui.overlay", "unblockAutoplay", function() {
                console.log("[OverlayManager] User clicked unblock button. Resuming stream...");
                var syncEngine = self.kernel.get("sync");
                var heartbeats = self.kernel.get("sync.heartbeats");
                var snapshots = self.kernel.get("sync.snapshots");
                
                var adapter = syncEngine.getAdapter();
                if (adapter) {
                    adapter.play();
                    var snapshot = snapshots.getSnapshot();
                    if (snapshot && heartbeats.lastHeartbeatTime) {
                        var elapsed = (Date.now() - heartbeats.lastHeartbeatTime) / 1000;
                        var hostTime = snapshot.currentTime + (snapshot.playing ? elapsed : 0);
                        adapter.seek(hostTime);
                    }
                }

                syncEngine.isPlaying = true;
                var recovery = self.kernel.get("recovery");
                if (recovery) {
                    recovery.retryCount = 0;
                }
                syncEngine.lastTimeProgression = Date.now();
                self.hideBlockedAutoplayUI();
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UI: HudRenderer
    // ═══════════════════════════════════════════════════════════════════════
    class HudRenderer {
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
            var self = this;
            var isDebug = new URLSearchParams(window.location.search).get('debug') === 'true' || 
                            window.location.hostname === 'localhost' || 
                            window.location.hostname === '127.0.0.1';
            
            var hud = document.getElementById("partyDebugOverlay");
            if (!hud) return;

            if (!isDebug) {
                hud.style.display = "none";
                return;
            }

            hud.style.display = "block";

            if (self.debugHudInterval) clearInterval(self.debugHudInterval);
            self.debugHudInterval = setInterval(function() {
                if (document.visibilityState === 'hidden') return;
                var failureIsolation = self.kernel.get("recovery.failureIsolation");
                failureIsolation.runSafe("ui.hud", "renderHud", function() {
                    var socket = self.kernel.get("socket");
                    var syncEngine = self.kernel.get("sync");
                    var fsm = self.kernel.get("fsm");
                    var metricsStore = self.kernel.get("metrics");
                    var heartbeats = self.kernel.get("sync.heartbeats");
                    var confidenceManager = self.kernel.get("sync.confidence");
                    var presence = self.kernel.get("network.presence");
                    var reconnect = self.kernel.get("recovery.reconnect");

                    if (!socket || !socket.isConnected()) {
                        hud.innerHTML = '<strong>Watch Together Debug HUD</strong><br>' +
                            'Socket: <span style="color:#ff4444">OFFLINE</span><br>' +
                            'Room: ' + (reconnect && reconnect.roomId ? reconnect.roomId : 'N/A') + '<br>' +
                            'Host: ' + (presence && presence.hostId ? presence.hostId : 'N/A');
                        return;
                    }

                    syncEngine.getPlayerTime().then(function(localTime) {
                        var hostTime = localTime;
                        var drift = 0;

                        if (!socket.isHost && heartbeats.lastHeartbeatTime > 0) {
                            var elapsed = (Date.now() - heartbeats.lastHeartbeatTime) / 1000;
                            hostTime = syncEngine.lastHostTime + (syncEngine.lastHostPlaying ? elapsed : 0);
                            drift = localTime - hostTime;
                        }

                        var statusText = socket.isConnected() ? "CONNECTED" : "DISCONNECTED";
                        var age = heartbeats.lastHeartbeatTime > 0 ? ((Date.now() - heartbeats.lastHeartbeatTime) / 1000).toFixed(1) + "s" : "N/A";
                        var vis = document.visibilityState || "visible";
                        var adapter = syncEngine.getAdapter();
                        var adapterType = adapter ? adapter.constructor.name : "None";
                        var confidence = confidenceManager.getConfidence().toUpperCase();
                        var fsmState = fsm ? fsm.currentState : "UNKNOWN";
                        var roomId = reconnect && reconnect.roomId ? reconnect.roomId : "N/A";
                        var hostId = presence && presence.hostId ? presence.hostId : "N/A";
                        var lastPlaybackEvent = syncEngine.lastPlaybackEvent ? JSON.stringify(syncEngine.lastPlaybackEvent) : 'None';
                        var lastProviderCommand = syncEngine.lastProviderCommand ? JSON.stringify(syncEngine.lastProviderCommand) : 'None';
                        var lastSyncAge = syncEngine.lastSyncTimestamp ? ((Date.now() - syncEngine.lastSyncTimestamp) / 1000).toFixed(1) + 's' : 'N/A';
                        var telemetry = typeof syncEngine.getTelemetryStatus === 'function'
                            ? syncEngine.getTelemetryStatus()
                            : {
                                source: 'none',
                                pollingActive: false,
                                syntheticClockEnabled: false,
                                capabilities: {},
                                softSyncMode: false,
                                lastTelemetryAgeMs: null
                            };
                        var telemetryAge = telemetry.lastTelemetryAgeMs !== null
                            ? (telemetry.lastTelemetryAgeMs / 1000).toFixed(1) + 's'
                            : 'N/A';
                        var capabilityMatrix = telemetry.capabilities
                            ? 'cmd=' + (telemetry.capabilities.supportsCommands ? 'Y' : 'N') +
                              ' telem=' + (telemetry.capabilities.supportsTelemetry ? 'Y' : 'N') +
                              ' seek=' + (telemetry.capabilities.supportsSeeking ? 'Y' : 'N') +
                              ' rate=' + (telemetry.capabilities.supportsPlaybackRate ? 'Y' : 'N')
                            : 'N/A';

                        var metrics = metricsStore.metrics;
                        var avgDrift = metricsStore.getAverageDrift().toFixed(3) + "s";
                        var avgRtt = metricsStore.getAverageRtt(socket.rtt) + "ms";
                        
                        hud.innerHTML =
                            '<strong>Watch Together Debug HUD</strong><br>' +
                            'Status: <span style="color: ' + (socket.isConnected() ? '#00ff66' : '#ff4444') + '">' + statusText + '</span><br>' +
                            'Room: ' + roomId + '<br>' +
                            'Host: ' + hostId + '<br>' +
                            'FSM State: <span style="color: #00e5ff">' + fsmState + '</span><br>' +
                            'Confidence: <span style="color: #f5a623">' + confidence + '</span><br>' +
                            'Role: ' + (socket.isHost ? "HOST" : "GUEST") + '<br>' +
                            'Adapter: ' + adapterType + '<br>' +
                            'RTT: ' + (socket.rtt || 0) + 'ms (Avg: ' + avgRtt + ')<br>' +
                            'Last Sync: ' + lastSyncAge + '<br>' +
                            'Telemetry Source: ' + (telemetry.source || 'none') + '<br>' +
                            'Telemetry Age: ' + telemetryAge + '<br>' +
                            'Polling Active: ' + (telemetry.pollingActive ? 'YES' : 'NO') + '<br>' +
                            'Synthetic Clock: ' + (telemetry.syntheticClockEnabled ? 'YES' : 'NO') + '<br>' +
                            'Soft Sync Mode: ' + (telemetry.softSyncMode ? 'YES' : 'NO') + '<br>' +
                            'Capabilities: ' + capabilityMatrix + '<br>' +
                            'Heartbeat Age: ' + age + '<br>' +
                            'Tab Visibility: ' + vis + '<br>' +
                            'Local Playhead: ' + localTime.toFixed(2) + 's<br>' +
                            'Host Playhead: ' + hostTime.toFixed(2) + 's<br>' +
                            'Drift: <span style="color: ' + (Math.abs(drift) > syncEngine.maxDriftSeconds ? '#ff4444' : '#00ff66') + '">' + drift.toFixed(3) + 's</span> (Avg: ' + avgDrift + ')<br>' +
                            'Max Allowed Drift: ' + syncEngine.maxDriftSeconds + 's<br>' +
                            'Current Event: ' + lastPlaybackEvent + '<br>' +
                            'Provider Cmd: ' + lastProviderCommand + '<br>' +
                            '<hr style="border:0;border-top:1px solid rgba(255,255,255,0.2);margin:4px 0;">' +
                            '<strong>Metrics:</strong><br>' +
                            'Hard Seeks: ' + metrics.hardSeeksCount + '<br>' +
                            'Stalls: ' + metrics.stallsCount + '<br>' +
                            'Recovery Seeks: ' + metrics.recoveryAttempts + '<br>' +
                            'Iframe Reloads: ' + metrics.providerReloads + '<br>' +
                            'Socket Reconnects: ' + metrics.reconnectCount + '<br>' +
                            'Heartbeat Misses: ' + metrics.heartbeatMisses;
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

    // ═══════════════════════════════════════════════════════════════════════
    // BOOTSTRAP: window.startModularWatchTogether
    // ═══════════════════════════════════════════════════════════════════════
    window.startModularWatchTogether = function (isHost, inputPartyId, userName, videoId, videoType, playerWrapper) {
        console.log("[VAILISM BOOT] Runtime bootstrap initialized");
        console.log("[VAILISM BOOT] Initializing modular Watch Together runtime...");
        console.log("[VAILISM BOOT] isHost=" + isHost + " userName=" + userName + " videoId=" + videoId);

        var kernel = new RuntimeKernel();
        
        // Core Services
        var eventBus = new EventBus();
        kernel.register("eventBus", eventBus);
        kernel.register("logger", new RuntimeLogger());
        kernel.register("metrics", new MetricsStore());
        kernel.register("fsm", new PlaybackStateMachine());
        kernel.register("recovery.failureIsolation", new FailureIsolation());
        
        // Networking Services
        var socket = new SocketManager();
        kernel.register("socket", socket);
        
        var presence = new PresenceManager();
        presence.username = userName;
        kernel.register("network.presence", presence);
        kernel.register("network.quality", new ConnectionQualityMonitor());
        kernel.register("provider.health", new ProviderHealthMonitor());
        
        // Playback Sync Services
        kernel.register("sync.confidence", new SyncConfidenceManager());
        kernel.register("sync.snapshots", new SnapshotManager());
        kernel.register("sync.drift", new DriftController());
        kernel.register("sync.heartbeats", new HeartbeatManager());
        
        var syncEngine = new SyncEngine(playerWrapper);
        kernel.register("sync", syncEngine);
        
        // Recovery Services
        kernel.register("recovery.watchdog", new Watchdog());
        
        var reconnect = new ReconnectManager();
        kernel.register("recovery.reconnect", reconnect);
        kernel.register("recovery", new RecoveryManager());
        
        // UI Renderers
        kernel.register("ui.toast", new ToastManager());
        kernel.register("ui.status", new StatusRenderer());
        kernel.register("ui.presence", new PresenceRenderer());
        kernel.register("ui.overlay", new OverlayManager());
        kernel.register("ui.hud", new HudRenderer());

        // Inject parameters
        socket.isHost = isHost;
        
        // Bind globally for fallback/legacy updates
        window.VailRuntime = kernel;
        window._vailRuntimeBooted = true;

        // Boot subsystems topological sequence
        kernel.boot().then(function() {
            console.log("[VAILISM BOOT] Kernel boot complete. Initiating socket connection...");

            // Trigger Socket.io connect and rooms handshake
            var targetRoomId = inputPartyId || ('vail-' + Math.random().toString(36).substr(2, 9));
            reconnect.setRoomContext(targetRoomId, userName);
            var fsm = kernel.get("fsm");
            fsm.transitionTo("CONNECTING", "Bootstrapping watch-together socket connection");

            socket.connect(userName, function() {
                console.log("[VAILISM SOCKET] Connected successfully. Setting up room...");
                fsm.transitionTo("JOINING", "Socket connected, joining room");
                if (isHost) {
                    socket.createRoom(videoId, videoType, userName, function(res) {
                        if (res && !res.error) {
                            console.log("[VAILISM ROOM] Room created: " + res.roomId);
                            reconnect.setRoomContext(res.roomId, userName);
                            fsm.transitionTo("BUFFERING", "Host room created, awaiting playback readiness");
                            if (typeof window.setupShareLink === "function") {
                                window.setupShareLink(res.roomId);
                                console.log("[VAILISM PARTY] Share link generated for room: " + res.roomId);
                            }
                        } else {
                            console.error("[VAILISM ROOM] Room creation failed:", res ? res.error : "unknown error");
                        }
                    });
                } else {
                    socket.joinRoom(targetRoomId, userName, function(res) {
                        if (res && !res.error) {
                            console.log("[VAILISM ROOM] Joined room: " + targetRoomId);
                            fsm.transitionTo("BUFFERING", "Guest joined room, buffering stream");
                            if (typeof window.setupShareLink === "function") {
                                window.setupShareLink(targetRoomId);
                                console.log("[VAILISM PARTY] Share link generated for room: " + targetRoomId);
                            }
                        } else {
                            console.error("[VAILISM ROOM] Join failed:", res ? res.error : "unknown error");
                        }
                    });
                }
            });
        });

        // Set up backwards compatible global toasts
        window.showToast = function(msg) { eventBus.emit("SHOW_TOAST", { message: msg }); };
        
        return kernel;
    };

    console.log("[VAILISM BOOT] Runtime bundle loaded. window.startModularWatchTogether is now available.");

})();
