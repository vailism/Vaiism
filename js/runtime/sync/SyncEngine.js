import { VidlinkAdapter } from '../provider/VidlinkAdapter.js';
import { VidsrcAdapter } from '../provider/VidsrcAdapter.js';
import { GenericIframeAdapter } from '../provider/GenericIframeAdapter.js';

export class SyncEngine {
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

        // Bind incoming sync listener
        this.eventBus.on("REMOTE_SYNC_RECEIVED", (payload) => {
            this.handleRemoteSync(payload);
        });

        // Start heartbeat transmit loops on host
        const heartbeats = this.kernel.get("sync.heartbeats");
        if (socket.isHost) {
            heartbeats.startSending(this);
        }

        if (this.isJoinBuffered) {
            this.eventBus.emit("JOIN_BUFFER_START", { statusText: "Syncing playback..." });
        }

        this.eventBus.on("VISIBILITY_CHANGED", (data) => {
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
    }

    getAdapter() {
        if (!this.wrapper) return null;
        const iframe = this.wrapper.querySelector("iframe");
        if (!iframe) return null;
        const src = iframe.src || "";
        if (src.includes("vidlink.pro")) {
            return new VidlinkAdapter(iframe);
        } else if (src.includes("vidsrc.to")) {
            return new VidsrcAdapter(iframe);
        } else {
            return new GenericIframeAdapter(iframe);
        }
    }

    normalizeMessage(payload) {
        const adapter = this.getAdapter();
        return adapter ? adapter.normalizeMessage(payload) : null;
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
                setTimeout(() => resolve(0), 120);
            } catch (e) {
                resolve(0);
            }
        });
    }

    handleRemoteSync(payload) {
        const socket = this.kernel.get("socket");
        if (socket.isHost) return;

        const { action, currentTime, playing, ts } = payload;
        
        if (this.isJoinBuffered) {
            this.pendingHostPayload = payload;
            this.eventBus.emit("JOIN_BUFFER_PROGRESS", { statusText: "Buffering stream..." });
            return;
        }

        this.isSyncingLocal = true;
        const networkLag = (Date.now() - ts) / 1000;
        const targetTime = currentTime + (playing ? networkLag : 0);

        console.log(`[SyncEngine] Remote sync: ${action} at ${targetTime.toFixed(1)}s (lag=${networkLag.toFixed(2)}s)`);

        const adapter = this.getAdapter();
        if (adapter) {
            if (playing !== this.isPlaying) {
                this.isPlaying = playing;
                const fsm = this.kernel.get("fsm");
                fsm.transitionTo(playing ? 'PLAYING' : 'PAUSED', `Remote command: ${action}`);
                if (playing) {
                    adapter.play();
                } else {
                    adapter.pause();
                }
            }
            
            const drift = this.kernel.get("sync.drift");
            this.getPlayerTime().then(localSeconds => {
                const confidence = drift.adjustPlayback(localSeconds, targetTime, adapter, playing);
                const confidenceManager = this.kernel.get("sync.confidence");
                if (confidenceManager.getConfidence() !== "unstable") {
                    confidenceManager.setConfidence(confidence);
                }
            });
        }

        setTimeout(() => {
            this.isSyncingLocal = false;
        }, 500);
    }

    handleLocalPlayerEvent(evtName, currentTime, duration, normalized) {
        this.eventBus.emit("PLAYER_EVENT_RECEIVED", { evtName, currentTime, duration });

        if (this.isJoinBuffered) {
            if (evtName === 'ready' || (evtName === 'timeupdate' && currentTime > 0)) {
                console.log("[SyncEngine] Guest stream ready. Completing join sync...");
                this.isJoinBuffered = false;
                this.eventBus.emit("JOIN_BUFFER_COMPLETE");
                
                if (this.pendingHostPayload) {
                    const payload = this.pendingHostPayload;
                    this.pendingHostPayload = null;
                    
                    const networkLag = (Date.now() - payload.ts) / 1000;
                    const targetTime = payload.currentTime + (payload.playing ? networkLag : 0);
                    
                    this.isSyncingLocal = true;
                    const adapter = this.getAdapter();
                    if (adapter) {
                        adapter.seek(targetTime);
                        const fsm = this.kernel.get("fsm");
                        if (payload.playing) {
                            this.isPlaying = true;
                            fsm.transitionTo('PLAYING', 'Aligned with host playing on join');
                            adapter.play();
                        } else {
                            this.isPlaying = false;
                            fsm.transitionTo('PAUSED', 'Aligned with host paused on join');
                            adapter.pause();
                        }
                    }
                    
                    setTimeout(() => {
                        this.isSyncingLocal = false;
                        const confidenceManager = this.kernel.get("sync.confidence");
                        confidenceManager.setConfidence("synced");
                    }, 500);
                } else {
                    const fsm = this.kernel.get("fsm");
                    fsm.transitionTo(this.isPlaying ? 'PLAYING' : 'PAUSED', 'No pending host payload on join');
                    const confidenceManager = this.kernel.get("sync.confidence");
                    confidenceManager.setConfidence("synced");
                }
            }
            return;
        }

        const fsm = this.kernel.get("fsm");
        if (fsm.currentState === 'SYNCING' && evtName === 'timeupdate') {
            fsm.transitionTo(this.isPlaying ? 'PLAYING' : 'PAUSED', 'Resumed playhead progression after seek');
        }

        const socket = this.kernel.get("socket");
        if (!socket.isHost && evtName === 'timeupdate') {
            const adapter = this.getAdapter();
            const drift = this.kernel.get("sync.drift");
            this.eventBus.emit("LOCAL_PLAYER_TIME_UPDATE", { currentTime });
            if (adapter) {
                // Call checkDriftProgress inline
                const elapsed = (Date.now() - this.kernel.get("sync.heartbeats").lastHeartbeatTime) / 1000;
                const snapshots = this.kernel.get("sync.snapshots");
                const snapshot = snapshots.getSnapshot();
                if (snapshot) {
                    const hostTime = snapshot.currentTime + (snapshot.playing ? elapsed : 0);
                    const confidence = drift.adjustPlayback(currentTime, hostTime, adapter, snapshot.playing);
                    const confidenceManager = this.kernel.get("sync.confidence");
                    if (confidenceManager.getConfidence() !== "unstable") {
                        confidenceManager.setConfidence(confidence);
                    }
                }
            }
            return;
        }

        if (!socket.isHost || this.isSyncingLocal) return;
        if (evtName === 'timeupdate') return;

        console.log(`[SyncEngine] Local Host Event: ${evtName} at ${currentTime.toFixed(1)}s`);
        const adapter = this.getAdapter();

        if (evtName === "play") {
            this.isPlaying = true;
            fsm.transitionTo('PLAYING', 'Host local play event');
            socket.emitSyncEvent({
                currentTime,
                playing: true,
                paused: false,
                buffering: false,
                playbackRate: 1.0,
                ts: Date.now()
            });
            this.eventBus.emit("LOCAL_SYNC_BROADCASTED", { action: "PLAY", currentTime, playing: true, ts: Date.now() });
        } else if (evtName === "pause") {
            this.isPlaying = false;
            fsm.transitionTo('PAUSED', 'Host local pause event');
            socket.emitSyncEvent({
                currentTime,
                playing: false,
                paused: true,
                buffering: false,
                playbackRate: 1.0,
                ts: Date.now()
            });
            this.eventBus.emit("LOCAL_SYNC_BROADCASTED", { action: "PAUSE", currentTime, playing: false, ts: Date.now() });
        } else if (evtName === "seek" || evtName === "seeked") {
            fsm.transitionTo('SYNCING', 'Host local seek event');
            if (this.seekDebounceTimeout) clearTimeout(this.seekDebounceTimeout);
            this.seekDebounceTimeout = setTimeout(() => {
                socket.emitSyncEvent({
                    currentTime,
                    playing: this.isPlaying,
                    paused: !this.isPlaying,
                    buffering: false,
                    playbackRate: 1.0,
                    ts: Date.now()
                });
                this.eventBus.emit("LOCAL_SYNC_BROADCASTED", { action: "SEEK", currentTime, playing: this.isPlaying, ts: Date.now() });
                fsm.transitionTo(this.isPlaying ? 'PLAYING' : 'PAUSED', 'Resumed after local seek broadcast');
            }, 250);
        }
    }
}
