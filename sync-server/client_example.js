/**
 * @file client_example.js
 * @description Frontend connection template for Socket.io integration.
 * Shows connection setups, custom event listeners, and playhead sync triggers.
 */

// 1. Install socket.io-client dependency or script tag:
// <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>

class WatchTogetherClient {
    /**
     * @param {string} serverUrl Sync backend base URL (e.g. Render Web Service URL)
     * @param {object} playerInterface Object hooks to control the video player
     */
    constructor(serverUrl, playerInterface) {
        this.serverUrl = serverUrl;
        this.player = playerInterface;
        this.socket = null;
        this.roomId = null;
        this.isHost = false;
        this.isSyncingLocal = false; // Lock flag to ignore duplicate incoming changes
        this.typingTimeout = null;
    }

    /**
     * Establish socket connection with custom configs
     */
    connect(userName) {
        console.log(`[SyncClient] Connecting to sync server: ${this.serverUrl}`);
        
        // Configuration optimizations for unstable networks:
        // - transports: Force 'websocket' to prevent slow long-polling handshakes on mobile.
        // - reconnectionAttempts: Keep attempting to reconnect during mobile data dropouts.
        this.socket = io(this.serverUrl, {
            transports: ['websocket'],
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 20000
        });

        this._registerSocketEvents(userName);
    }

    _registerSocketEvents(userName) {
        this.socket.on('connect', () => {
            console.log(`[SyncClient] Connected successfully! Socket ID: ${this.socket.id}`);
            
            // Auto-rejoin if we were previously in an active room
            if (this.roomId) {
                console.log(`[SyncClient] Connection restored. Rejoining room: ${this.roomId}`);
                this.joinRoom(this.roomId, userName);
            }
        });

        this.socket.on('disconnect', (reason) => {
            console.warn(`[SyncClient] Disconnected. Reason: ${reason}`);
            // Note: Socket.io-client automatically triggers reconnection attempts
        });

        this.socket.on('connect_error', (error) => {
            console.error('[SyncClient] Connection error:', error);
        });

        // ── Inbound Playback Sync Listener ──────────────────────────────────
        this.socket.on('sync-state', (data) => {
            if (this.isHost) return; // Host ignores sync signals
            
            this.isSyncingLocal = true;
            const { action, currentTime, ts } = data;

            // Apply network latency adjustment
            const latency = (Date.now() - ts) / 1000;
            const targetTime = currentTime + (action === 'PLAY' ? latency : 0);

            console.log(`[SyncClient] Sync state received: ${action} at ${targetTime}s`);

            if (action === 'PLAY') {
                this.player.play();
                this._correctDrift(targetTime);
            } else if (action === 'PAUSE') {
                this.player.pause();
                this._correctDrift(targetTime);
            }
            
            // Release local event lock
            setTimeout(() => { this.isSyncingLocal = false; }, 400);
        });

        // ── Host Migration Listener ─────────────────────────────────────────
        this.socket.on('host-changed', (data) => {
            console.log(`[SyncClient] Host migrated! New Host ID: ${data.hostId}`);
            this.isHost = (data.hostId === this.socket.id);
            
            if (this.isHost) {
                console.log('[SyncClient] You are the new Room Host. Sync controls unlocked.');
                this._startHeartbeatLoop();
            }
        });

        this.socket.on('user-joined', (data) => {
            console.log(`[SyncClient] User joined room: ${data.name}`);
        });

        this.socket.on('user-left', (data) => {
            console.log(`[SyncClient] User left room: ${data.name}`);
        });

        this.socket.on('chat-message', (data) => {
            console.log(`[Chat] ${data.senderName}: ${data.text}`);
        });

        this.socket.on('typing', (data) => {
            console.log(`[Chat] ${data.senderName} is ${data.isTyping ? 'typing...' : 'silent'}`);
        });

        this.socket.on('error-msg', (error) => {
            console.error('[SyncClient] Server error:', error.message);
        });
    }

    // ── Actions ─────────────────────────────────────────────────────────────

    createRoom(videoId, videoType, hostName) {
        this.socket.emit('create-room', { videoId, videoType, hostName }, (res) => {
            if (res.error) {
                console.error('[SyncClient] Failed to create room:', res.error);
                return;
            }
            this.roomId = res.roomId;
            this.isHost = true;
            console.log(`[SyncClient] Created Room: ${this.roomId}`);
            this._startHeartbeatLoop();
        });
    }

    joinRoom(roomId, userName) {
        this.socket.emit('join-room', { roomId, userName }, (res) => {
            if (res.error) {
                console.error('[SyncClient] Failed to join room:', res.error);
                return;
            }
            this.roomId = roomId;
            this.isHost = (res.hostId === this.socket.id);
            console.log(`[SyncClient] Joined Room: ${this.roomId}, isHost: ${this.isHost}`);
            
            // Sync playhead state with current room state
            if (!this.isHost && res.lastSync) {
                const latency = (Date.now() - res.lastSync.ts) / 1000;
                const targetTime = res.lastSync.currentTime + (res.lastSync.playing ? latency : 0);
                
                this.isSyncingLocal = true;
                this.player.seek(targetTime);
                if (res.lastSync.playing) {
                    this.player.play();
                } else {
                    this.player.pause();
                }
                setTimeout(() => { this.isSyncingLocal = false; }, 400);
            }
        });
    }

    sendPlaybackEvent(event, currentTime) {
        if (!this.isHost || this.isSyncingLocal) return;

        this.socket.emit('sync-event', {
            currentTime,
            playing: (event === 'play')
        });
    }

    sendChatMessage(text) {
        this.socket.emit('chat-message', { text });
    }

    sendTypingIndicator(isTyping) {
        this.socket.emit('typing', { isTyping });
    }

    // ── Internal Helpers ────────────────────────────────────────────────────

    _correctDrift(targetTime) {
        const localTime = this.player.getCurrentTime();
        const drift = Math.abs(localTime - targetTime);
        // Seek playhead if difference is larger than 1.5 seconds threshold
        if (drift > 1.5) {
            this.player.seek(targetTime);
        }
    }

    _startHeartbeatLoop() {
        // Keeps the socket connection alive by emitting a simple heartbeat ping every 15 seconds
        setInterval(() => {
            this.socket.emit('heartbeat');
        }, 15000);
    }
}
