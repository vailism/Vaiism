export class SocketManager {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.socket = null;
        this.serverUrl = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
            ? 'http://localhost:3000'
            : 'https://vailism-sync.onrender.com';
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        // Connection initiated dynamically via kernel boot or user events
    }

    onStop() {
        this.disconnect();
    }

    connect(userName, connectionCallback) {
        if (this.socket) {
            console.warn("[SocketManager] Socket already exists. Disconnecting old session.");
            this.disconnect();
        }

        console.log(`[SocketManager] Connecting to sync server: ${this.serverUrl}`);
        this.eventBus.emit("SOCKET_CONNECT_INITIATED", { url: this.serverUrl });

        const io = window.io;
        if (!io) {
            console.error("[SocketManager] socket.io-client library (window.io) not found! Ensure cdn is loaded.");
            this.eventBus.emit("SOCKET_ERROR_RECEIVED", { message: "Socket.io library missing" });
            return;
        }

        this.socket = io(this.serverUrl, {
            transports: ['websocket'],
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });

        this.socket.on('connect', () => {
            console.log(`[SocketManager] Connected! Socket ID: ${this.socket.id}`);
            this.eventBus.emit("SOCKET_CONNECTED", { socketId: this.socket.id });
            if (connectionCallback) {
                try {
                    connectionCallback();
                } catch (e) {
                    console.error("[SocketManager] Error in connect callback:", e);
                }
            }
        });

        this.socket.on('disconnect', (reason) => {
            console.warn(`[SocketManager] Disconnected. Reason: ${reason}`);
            this.eventBus.emit("SOCKET_DISCONNECTED", { reason });
        });

        this.socket.on('connect_error', (error) => {
            console.error('[SocketManager] Connection error:', error);
            this.eventBus.emit("SOCKET_CONNECT_ERROR", { message: error ? error.message : "Unknown error" });
        });

        this.socket.on('sync-state', (data) => {
            this.eventBus.emit("REMOTE_SYNC_RECEIVED", data);
        });

        this.socket.on('chat-message', (data) => {
            this.eventBus.emit("CHAT_MESSAGE_RECEIVED", data);
        });

        this.socket.on('typing', (data) => {
            this.eventBus.emit("REMOTE_TYPING_RECEIVED", data);
        });

        this.socket.on('host-changed', (data) => {
            this.eventBus.emit("HOST_CHANGED_RECEIVED", data);
        });

        this.socket.on('user-joined', (data) => {
            this.eventBus.emit("USER_JOINED_RECEIVED", data);
        });

        this.socket.on('user-left', (data) => {
            this.eventBus.emit("USER_LEFT_RECEIVED", data);
        });

        this.socket.on('error-msg', (data) => {
            this.eventBus.emit("SOCKET_ERROR_RECEIVED", data);
        });
    }

    disconnect() {
        if (this.socket) {
            try {
                this.socket.disconnect();
            } catch (e) {
                console.error("[SocketManager] Error on disconnect:", e);
            }
            this.socket = null;
        }
    }

    createRoom(videoId, videoType, hostName, callback) {
        if (!this.socket) return;
        this.socket.emit('create-room', { videoId, videoType, hostName }, (res) => {
            if (callback) {
                try {
                    callback(res);
                } catch (e) {
                    console.error("[SocketManager] Error in createRoom callback:", e);
                }
            }
        });
    }

    joinRoom(roomId, userName, callback) {
        if (!this.socket) return;
        this.socket.emit('join-room', { roomId, userName }, (res) => {
            if (callback) {
                try {
                    callback(res);
                } catch (e) {
                    console.error("[SocketManager] Error in joinRoom callback:", e);
                }
            }
        });
    }

    emitSyncEvent(data) {
        if (!this.socket) return;
        this.socket.emit('sync-event', data);
    }

    emitChatMessage(text) {
        if (!this.socket) return;
        this.socket.emit('chat-message', { text });
    }

    emitTyping(isTyping) {
        if (!this.socket) return;
        this.socket.emit('typing', { isTyping });
    }

    emitHeartbeat() {
        if (!this.socket) return;
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
