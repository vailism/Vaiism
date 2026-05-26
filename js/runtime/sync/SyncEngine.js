import { VidlinkAdapter } from '../provider/VidlinkAdapter.js';
import { VidsrcAdapter } from '../provider/VidsrcAdapter.js';
import { VideasyAdapter } from '../provider/VideasyAdapter.js';
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
        this.forceHardSync = false;
        this.providerSyncMode = 'safe';
        this.aggressiveSeekingDisabled = false;
        this.seekCooldownUntil = 0;
        this.bufferingSince = 0;
        this.syncFrozenUntil = 0;
        this.softConvergenceActive = false;
        this.lastSuccessfulConvergence = null;
        this.providerReady = false;
        this.providerStability = {
            successfulSeeks: 0,
            failedSeeks: 0,
            bufferingFreezes: 0,
            reloadRecoveries: 0,
            softConvergences: 0
        };
        this.lastAppliedSeek = null;
        this.lastAppliedRemoteSnapshot = null;
        this.lastVerifiedPlaybackTime = null;
        this.commandVerification = {
            total: 0,
            success: 0,
            failed: 0,
            rate: 0
        };
        this.pendingRestoreAfterReload = null;
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
        this.forceHardSync = this.readForceHardSyncFlag();

        this.refreshAdapter(true);

        // Bind incoming sync listener
        this.eventBus.on("REMOTE_SYNC_RECEIVED", (payload) => {
            this.handleRemoteSync(payload);
        });
        this.eventBus.on('FORCE_SYNC_NOW', () => {
            this.forceSyncNow();
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
            this.providerReady = true;
            this.updateProviderSyncMode(adapter, capabilities);

            if (typeof adapter.setTelemetryListener === 'function') {
                adapter.setTelemetryListener((snapshot) => {
                    this.handleProviderTelemetry(snapshot);
                });
            }
            if (typeof adapter.setCommandResultListener === 'function') {
                adapter.setCommandResultListener((result) => {
                    this.handleProviderCommandResult(result);
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
            if (typeof nextAdapter.setCommandResultListener === 'function') {
                nextAdapter.setCommandResultListener((result) => {
                    this.handleProviderCommandResult(result);
                });
            }
            if (typeof nextAdapter.startPolling === 'function') {
                nextAdapter.startPolling();
            }
            if (typeof nextAdapter.getCapabilities === 'function') {
                this.providerCapabilities = nextAdapter.getCapabilities();
                this.softSyncMode = !this.providerCapabilities.supportsTelemetry;
                this.providerReady = true;
                this.updateProviderSyncMode(nextAdapter, this.providerCapabilities);
            }
            this.pollingActive = !!nextAdapter.pollingActive;
        }

        return nextAdapter;
    }

    getAdapterType() {
        const adapter = this.getAdapter();
        return adapter ? adapter.constructor.name : 'None';
    }

    readForceHardSyncFlag() {
        try {
            const urlValue = new URLSearchParams(window.location.search).get('forceHardSync');
            if (urlValue === '1' || urlValue === 'true') return true;
            if (window.FORCE_HARD_SYNC === true) return true;
            if (window.localStorage && window.localStorage.getItem('FORCE_HARD_SYNC') === 'true') return true;
        } catch (error) {
            console.warn('[VAILISM RECONCILE] Failed reading FORCE_HARD_SYNC flag', error);
        }
        return false;
    }

    getCommandSuccessRate() {
        if (!this.commandVerification.total) return 0;
        return (this.commandVerification.success / this.commandVerification.total) * 100;
    }

    getProviderName(adapter = null) {
        const currentAdapter = adapter || this.adapter || this.getAdapter();
        return currentAdapter ? currentAdapter.constructor.name : 'None';
    }

    updateProviderSyncMode(adapter, capabilities = null) {
        const providerName = this.getProviderName(adapter);
        const providerCaps = capabilities || (adapter && typeof adapter.getCapabilities === 'function' ? adapter.getCapabilities() : this.providerCapabilities);
        const defaultSafe = providerName.includes('Vidsrc') || providerName.includes('Videasy');
        const score = this.getProviderStabilityScore();

        if (this.aggressiveSeekingDisabled || score < 45) {
            this.providerSyncMode = 'safe';
        } else if (defaultSafe) {
            this.providerSyncMode = 'safe';
        } else if (providerCaps && providerCaps.supportsSeeking && !this.softSyncMode) {
            this.providerSyncMode = 'precise';
        } else {
            this.providerSyncMode = 'safe';
        }
    }

    getProviderStabilityScore() {
        const seeks = this.providerStability.successfulSeeks;
        const failures = this.providerStability.failedSeeks;
        const freezes = this.providerStability.bufferingFreezes;
        const reloads = this.providerStability.reloadRecoveries;
        const softs = this.providerStability.softConvergences;
        const raw = 100 + (seeks * 6) - (failures * 22) - (freezes * 18) - (reloads * 14) + (softs * 1);
        return Math.max(0, Math.min(100, raw));
    }

    isSeekCooldownActive() {
        return Date.now() < this.seekCooldownUntil;
    }

    isSyncFrozen() {
        return Date.now() < this.syncFrozenUntil;
    }

    isBufferingBlocked() {
        return this.bufferingSince > 0 && (Date.now() - this.bufferingSince) > 8000;
    }

    canPerformHardSeek(adapter, differenceSeconds) {
        if (!adapter || !this.providerReady) return false;
        if (!adapter.iframe || !adapter.iframe.contentWindow) return false;
        if (this.forceHardSync) return true;
        if (this.isSeekCooldownActive() || this.isSyncFrozen()) return false;
        if (this.isBufferingBlocked()) return false;
        if (this.aggressiveSeekingDisabled) return false;
        if (this.providerSyncMode !== 'precise') return false;
        if (!this.providerCapabilities.supportsSeeking) return false;
        return Math.abs(differenceSeconds) > 15;
    }

    noteSuccessfulConvergence(mode, details = {}) {
        this.softConvergenceActive = mode === 'soft';
        this.lastSuccessfulConvergence = {
            mode,
            ...details,
            ts: Date.now()
        };

        if (mode === 'soft') {
            this.providerStability.softConvergences += 1;
        }
    }

    noteHardSeekIssued(targetTime, differenceSeconds) {
        this.lastAppliedSeek = targetTime;
        this.seekCooldownUntil = Date.now() + 30000;
        this.softConvergenceActive = false;
        this.lastSuccessfulConvergence = {
            mode: 'hard',
            targetTime,
            differenceSeconds,
            ts: Date.now()
        };
    }

    noteProviderBufferingStart() {
        if (!this.bufferingSince) {
            this.bufferingSince = Date.now();
        }
    }

    noteProviderBufferingEnd() {
        this.bufferingSince = 0;
        if (this.isSyncFrozen() && Date.now() >= this.syncFrozenUntil) {
            this.syncFrozenUntil = 0;
        }
    }

    freezeSync(reason = 'buffering') {
        this.syncFrozenUntil = Date.now() + 10000;
        this.providerStability.bufferingFreezes += 1;
        this.softConvergenceActive = false;
        const confidenceManager = this.kernel.get('sync.confidence');
        if (confidenceManager) confidenceManager.setConfidence('unstable');
        console.warn('[VAILISM RECONCILE] Synchronization frozen', { reason, until: this.syncFrozenUntil });
    }

    unfreezeSyncIfReady() {
        if (this.syncFrozenUntil > 0 && Date.now() >= this.syncFrozenUntil && !this.isBufferingBlocked()) {
            this.syncFrozenUntil = 0;
            const confidenceManager = this.kernel.get('sync.confidence');
            if (confidenceManager && confidenceManager.getConfidence() === 'unstable') {
                confidenceManager.setConfidence('recovering');
            }
        }
    }

    recordProviderCommand(command, success, details = {}) {
        this.lastProviderCommand = {
            command,
            success,
            adapter: this.getAdapterType(),
            ts: Date.now(),
            ...details
        };
        this.eventBus.emit("PROVIDER_COMMAND_ATTEMPTED", this.lastProviderCommand);
    }

    sendProviderCommand(adapter, command, details = {}) {
        if (!adapter || typeof adapter.sendCommand !== 'function') {
            this.recordProviderCommand(command, false, { reason: 'adapter-missing' });
            return false;
        }

        const success = adapter.sendCommand(command, details);
        this.recordProviderCommand(command, success, details);
        return success;
    }

    getTelemetryStatus() {
        const commandRate = this.getCommandSuccessRate();
        return {
            source: this.telemetrySource,
            pollingActive: this.pollingActive,
            syntheticClockEnabled: this.syntheticClockEnabled,
            capabilities: { ...this.providerCapabilities },
            providerSyncMode: this.providerSyncMode,
            providerStabilityScore: this.getProviderStabilityScore(),
            aggressiveSeekingDisabled: this.aggressiveSeekingDisabled,
            seekCooldownActive: this.isSeekCooldownActive(),
            softConvergenceActive: this.softConvergenceActive,
            lastSuccessfulConvergence: this.lastSuccessfulConvergence,
            softSyncMode: this.softSyncMode,
            lastTelemetryAgeMs: this.lastTelemetryTimestamp ? Date.now() - this.lastTelemetryTimestamp : null,
            forceHardSync: this.forceHardSync,
            lastAppliedSeek: this.lastAppliedSeek,
            lastAppliedRemoteSnapshot: this.lastAppliedRemoteSnapshot,
            lastVerifiedPlaybackTime: this.lastVerifiedPlaybackTime,
            commandVerification: {
                ...this.commandVerification,
                rate: Number.isFinite(commandRate) ? commandRate : 0
            }
        };
    }

    handleProviderCommandResult(result) {
        if (!result) return;

        this.unfreezeSyncIfReady();

        this.commandVerification.total += 1;
        if (result.success) {
            this.commandVerification.success += 1;
        } else {
            this.commandVerification.failed += 1;
        }
        this.commandVerification.rate = this.getCommandSuccessRate();
        this.lastVerifiedPlaybackTime = Number.isFinite(result.after && result.after.currentTime)
            ? result.after.currentTime
            : this.lastVerifiedPlaybackTime;

        if (result.command === 'seek') {
            if (result.success) {
                this.providerStability.successfulSeeks += 1;
                this.providerStability.reloadRecoveries += 0;
                this.noteSuccessfulConvergence('hard', {
                    command: result.command,
                    targetTime: result.after && Number.isFinite(result.after.currentTime) ? result.after.currentTime : null
                });
            } else {
                this.providerStability.failedSeeks += 1;
                if (this.providerStability.failedSeeks >= 2) {
                    this.aggressiveSeekingDisabled = true;
                    this.providerSyncMode = 'safe';
                }
            }
        } else if (result.success && (result.command === 'play' || result.command === 'pause' || result.command === 'setPlaybackRate')) {
            this.noteSuccessfulConvergence(result.command === 'setPlaybackRate' ? 'soft' : 'state', {
                command: result.command,
                playbackTime: result.after && Number.isFinite(result.after.currentTime) ? result.after.currentTime : null
            });
        }

        this.updateProviderSyncMode(this.getAdapter());

        this.eventBus.emit('PROVIDER_COMMAND_VERIFIED', {
            ...result,
            aggregate: { ...this.commandVerification },
            rate: this.commandVerification.rate,
            ts: Date.now()
        });

        if (!result.success && result.command === 'seek') {
            this.handleSeekCommandFailure(result);
        }
    }

    handleSeekCommandFailure(result) {
        if (this.providerStability.failedSeeks >= 2) {
            this.aggressiveSeekingDisabled = true;
            this.providerSyncMode = 'safe';
        }

        const adapter = this.getAdapter();
        if (!adapter || !adapter.iframe) return;

        if (this.providerStability.failedSeeks < 3) {
            console.warn('[VAILISM COMMAND FAILED] Seek verification failed; keeping iframe live and downgrading sync mode.', {
                reason: result.reason,
                providerSyncMode: this.providerSyncMode,
                stability: this.providerStability
            });
            return;
        }

        if (!this.lastAppliedRemoteSnapshot) return;

        const metrics = this.kernel.get('metrics');
        if (metrics) metrics.increment('providerReloads');
        this.providerStability.reloadRecoveries += 1;

        this.pendingRestoreAfterReload = { ...this.lastAppliedRemoteSnapshot, ts: Date.now() };
        console.warn('[VAILISM COMMAND FAILED] Seek verification failed. Reloading iframe as last resort.', {
            reason: result.reason,
            snapshot: this.pendingRestoreAfterReload
        });

        try {
            const frame = adapter.iframe;
            const onLoad = () => {
                frame.removeEventListener('load', onLoad);
                setTimeout(() => {
                    const snapshot = this.pendingRestoreAfterReload;
                    this.pendingRestoreAfterReload = null;
                    if (snapshot) {
                        this.applyHardSnapshot(snapshot, 'reload-last-resort');
                    }
                }, 220);
            };
            frame.addEventListener('load', onLoad);
            if (frame.contentWindow && frame.contentWindow.location) {
                frame.contentWindow.location.reload();
            } else {
                frame.src = frame.src;
            }
        } catch (error) {
            console.error('[VAILISM COMMAND FAILED] Iframe reload fallback failed', error);
        }
    }

    applyHardSnapshot(snapshot, reason = 'forced') {
        const adapter = this.getAdapter();
        if (!adapter) return;

        const safeSnapshot = snapshot || {};
        const snapshotTs = Number.isFinite(safeSnapshot.ts) ? safeSnapshot.ts : Date.now();
        const currentTime = Number.isFinite(safeSnapshot.currentTime) ? safeSnapshot.currentTime : 0;
        const playing = typeof safeSnapshot.playing === 'boolean' ? safeSnapshot.playing : !safeSnapshot.paused;
        const lagSeconds = Math.max(0, (Date.now() - snapshotTs) / 1000);
        const targetTime = currentTime + (playing ? lagSeconds : 0);

        this.lastAppliedSeek = targetTime;
        this.lastAppliedRemoteSnapshot = {
            action: safeSnapshot.action || 'SNAPSHOT',
            currentTime,
            targetTime,
            playing,
            paused: !playing,
            ts: snapshotTs,
            reason,
            appliedAt: Date.now()
        };

        const localTime = Number.isFinite(this.lastLocalTime) ? this.lastLocalTime : 0;
        const drift = localTime - targetTime;
        this.noteHardSeekIssued(targetTime, drift);
        console.log('[VAILISM RECONCILE] Hard snapshot apply', {
            reason,
            hostTime: currentTime,
            localTime,
            calculatedDrift: drift,
            targetTime,
            forceHardSync: this.forceHardSync,
            reconciliationResult: 'hard-applied'
        });

        this.sendProviderCommand(adapter, 'seek', { time: targetTime, reason: `hard-sync:${reason}` });
        if (playing) {
            this.isPlaying = true;
            this.sendProviderCommand(adapter, 'play', { reason: `hard-sync:${reason}` });
        } else {
            this.isPlaying = false;
            this.sendProviderCommand(adapter, 'pause', { reason: `hard-sync:${reason}` });
        }

        this.eventBus.emit('FORCED_RECONCILIATION_APPLIED', {
            ...this.lastAppliedRemoteSnapshot,
            localTime,
            calculatedDrift: drift,
            reconciliationResult: 'hard-applied'
        });
    }

    forceSyncNow() {
        const socket = this.kernel.get('socket');
        const reconnectManager = this.kernel.get('recovery.reconnect');
        if (socket && reconnectManager && reconnectManager.roomId && reconnectManager.username) {
            socket.joinRoom(reconnectManager.roomId, reconnectManager.username, (res) => {
                const latest = res && res.lastSync ? res.lastSync : null;
                if (latest) {
                    this.applyHardSnapshot(latest, 'manual-button-fresh');
                    return;
                }

                const snapshots = this.kernel.get('sync.snapshots');
                const snapshot = snapshots && typeof snapshots.getSnapshot === 'function'
                    ? snapshots.getSnapshot()
                    : null;
                if (snapshot) {
                    this.applyHardSnapshot(snapshot, 'manual-button-cached');
                } else {
                    console.warn('[VAILISM RECONCILE] Force Sync Now requested, but no snapshot is available');
                }
            });
            return true;
        }

        const snapshots = this.kernel.get('sync.snapshots');
        const snapshot = snapshots && typeof snapshots.getSnapshot === 'function'
            ? snapshots.getSnapshot()
            : null;
        if (snapshot) {
            this.applyHardSnapshot(snapshot, 'manual-button-cached');
            return true;
        }

        console.warn('[VAILISM RECONCILE] Force Sync Now requested, but no snapshot is available');
        return false;
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

    shouldAbortSync() {
        return this.isSyncFrozen() || this.isBufferingBlocked();
    }

    getProviderStabilityStatus() {
        return {
            score: this.getProviderStabilityScore(),
            mode: this.providerSyncMode,
            seekCooldownActive: this.isSeekCooldownActive(),
            softConvergenceActive: this.softConvergenceActive,
            aggressiveSeekingDisabled: this.aggressiveSeekingDisabled,
            bufferingActive: this.isBufferingBlocked(),
            frozen: this.isSyncFrozen(),
            lastSuccessfulConvergence: this.lastSuccessfulConvergence,
            stability: { ...this.providerStability }
        };
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
        if (typeof snapshot.buffering === 'boolean') {
            if (snapshot.buffering) {
                this.noteProviderBufferingStart();
                if (this.isBufferingBlocked()) {
                    this.freezeSync('buffering>8s');
                }
            } else {
                this.noteProviderBufferingEnd();
            }
        }
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

        this.updateProviderSyncMode(adapter);

        const evtName = snapshot.type || 'timeupdate';
        this.handleLocalPlayerEvent(evtName, snapshot.currentTime || 0, snapshot.duration || 0, snapshot);
        this.maybeBroadcastSnapshot(snapshot);
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
        this.lastPlaybackEvent = { source: 'remote', action, currentTime, playing, ts };
        this.lastSyncTimestamp = Date.now();
        console.log(`[VAILISM SYNC] Received ${String(action || 'SYNC').toUpperCase()}`, payload);
        
        if (this.isJoinBuffered) {
            this.pendingHostPayload = payload;
            this.eventBus.emit("JOIN_BUFFER_PROGRESS", { statusText: "Buffering stream..." });
            return;
        }

        this.isSyncingLocal = true;
        const networkLag = (Date.now() - ts) / 1000;
        const targetTime = currentTime + (playing ? networkLag : 0);
        const localTime = Number.isFinite(this.lastLocalTime) ? this.lastLocalTime : 0;
        const calculatedDrift = localTime - targetTime;

        console.log('[VAILISM RECONCILE] Snapshot received', {
            action: action || 'SYNC',
            hostTime: currentTime,
            localTime,
            calculatedDrift,
            targetTime,
            forceHardSync: this.forceHardSync,
            reconciliationResult: this.forceHardSync ? 'hard-sync' : 'drift-controller'
        });

        console.log(`[SyncEngine] Remote sync: ${action} at ${targetTime.toFixed(1)}s (lag=${networkLag.toFixed(2)}s)`);

        const adapter = this.getAdapter();
        if (adapter) {
            if (this.forceHardSync) {
                this.applyHardSnapshot(payload, 'remote-sync');
                const confidenceManager = this.kernel.get('sync.confidence');
                if (confidenceManager) {
                    confidenceManager.setConfidence('stabilizing');
                }
                setTimeout(() => {
                    this.isSyncingLocal = false;
                }, 500);
                return;
            }

            if (playing !== this.isPlaying) {
                this.isPlaying = playing;
                const fsm = this.kernel.get("fsm");
                fsm.transitionTo(playing ? 'PLAYING' : 'PAUSED', `Remote command: ${action}`);
                if (playing) {
                    this.sendProviderCommand(adapter, 'play', { reason: 'remote-sync' });
                } else {
                    this.sendProviderCommand(adapter, 'pause', { reason: 'remote-sync' });
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
                        this.sendProviderCommand(adapter, 'seek', { time: targetTime, reason: 'join-sync' });
                        const fsm = this.kernel.get("fsm");
                        if (payload.playing) {
                            this.isPlaying = true;
                            fsm.transitionTo('PLAYING', 'Aligned with host playing on join');
                            this.sendProviderCommand(adapter, 'play', { reason: 'join-sync' });
                        } else {
                            this.isPlaying = false;
                            fsm.transitionTo('PAUSED', 'Aligned with host paused on join');
                            this.sendProviderCommand(adapter, 'pause', { reason: 'join-sync' });
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
        console.log(`[VAILISM SYNC] Emitting ${String(evtName).toUpperCase()}`, { currentTime, duration, normalized });
        const adapter = this.getAdapter();
        this.lastPlaybackEvent = { source: 'local', event: evtName, currentTime, duration, normalized, ts: Date.now() };
        this.lastSyncTimestamp = Date.now();

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
            this.eventBus.emit("SYNC_EVENT_EMITTED", { action: "PLAY", currentTime, playing: true, ts: Date.now() });
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
            this.eventBus.emit("SYNC_EVENT_EMITTED", { action: "PAUSE", currentTime, playing: false, ts: Date.now() });
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
                this.eventBus.emit("SYNC_EVENT_EMITTED", { action: "SEEK", currentTime, playing: this.isPlaying, ts: Date.now() });
                this.eventBus.emit("LOCAL_SYNC_BROADCASTED", { action: "SEEK", currentTime, playing: this.isPlaying, ts: Date.now() });
                fsm.transitionTo(this.isPlaying ? 'PLAYING' : 'PAUSED', 'Resumed after local seek broadcast');
            }, 250);
        }
    }
}
