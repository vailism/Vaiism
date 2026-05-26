export class ProviderAdapter {
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
    seek(time) { return this.sendCommand('seek', { time, currentTime: time, position: time }); }
    setPlaybackRate(rate) { return this.sendCommand('setPlaybackRate', { rate, playbackRate: rate }); }

    getCapabilities() {
        return { ...this.capabilities };
    }

    setCapabilities(partial = {}) {
        this.capabilities = { ...this.capabilities, ...partial };
    }

    getStateSnapshot() {
        return { ...this.lastKnownState, source: this.lastKnownState.source || 'cache' };
    }

    setTelemetryListener(listener) {
        this.telemetryListener = typeof listener === 'function' ? listener : null;
    }

    startPolling() {
        if (this.pollingActive) return;
        this.pollingActive = true;
        this.pollCount = 0;
        this.telemetryCount = 0;
        this.lastTickAt = Date.now();

        this.messageListener = (event) => this.onWindowMessage(event);
        window.addEventListener('message', this.messageListener);

        this.visibilityListener = () => {
            this.resetPollingInterval();
            console.log(`[VAILISM POLLER] Visibility changed to ${document.visibilityState}; poll=${this.getCurrentPollInterval()}ms`);
        };
        document.addEventListener('visibilitychange', this.visibilityListener);

        this.resetPollingInterval();
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
        if (!this.pollingActive) return;
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.pollTimer = setInterval(() => {
            this.pollPlaybackState();
        }, this.getCurrentPollInterval());
    }

    pollPlaybackState() {
        this.pollCount += 1;
        if (!this.iframe || !this.iframe.contentWindow) {
            return;
        }

        const queries = [
            { command: 'getCurrentTime' },
            { command: 'getPaused' },
            { command: 'getPlaybackRate' },
            { command: 'getDuration' },
            { command: 'getBuffering' },
            { type: 'getState' },
            { event: 'getState' },
            'getState'
        ];

        for (const query of queries) {
            try {
                const payload = typeof query === 'string' ? query : {
                    ...query,
                    source: 'vailism-poller',
                    ts: Date.now()
                };
                this.iframe.contentWindow.postMessage(payload, '*');
            } catch (error) {
                console.warn('[VAILISM POLLER] Failed to query playback state', error);
                break;
            }
        }

        if (this.telemetryCount === 0 && this.pollCount >= 3) {
            this.setCapabilities({ supportsTelemetry: false });
        }

        const telemetryAge = Date.now() - this.lastTelemetryAt;
        if (telemetryAge > 1800) {
            this.emitSyntheticTelemetry('poll-fallback');
        }
    }

    onWindowMessage(event) {
        if (!this.iframe || !this.iframe.contentWindow) return;
        if (event.source !== this.iframe.contentWindow) return;

        const snapshot = this.extractState(event.data);
        if (!snapshot) return;

        this.telemetryCount += 1;
        this.syntheticClockEnabled = false;
        this.setCapabilities({ supportsTelemetry: true });
        this.emitTelemetry({ ...snapshot, source: snapshot.source || 'iframe' }, false);
    }

    extractState(payload) {
        let data = payload;
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

        const currentTimeRaw = data.currentTime ?? data.time ?? data.position ?? data.progress;
        const durationRaw = data.duration ?? data.length ?? data.totalDuration;
        const rateRaw = data.playbackRate ?? data.rate ?? data.speed;
        const pausedRaw = data.paused;
        const playingRaw = data.playing;
        const bufferingRaw = data.buffering ?? data.waiting ?? data.loading;
        const eventTypeRaw = String(data.event || data.type || data.action || '').toLowerCase();

        const hasTime = Number.isFinite(parseFloat(currentTimeRaw));
        const hasDuration = Number.isFinite(parseFloat(durationRaw));
        const hasRate = Number.isFinite(parseFloat(rateRaw));
        const hasPaused = typeof pausedRaw === 'boolean' || typeof playingRaw === 'boolean';
        const hasBuffering = typeof bufferingRaw === 'boolean';

        if (!hasTime && !hasDuration && !hasRate && !hasPaused && !hasBuffering && !eventTypeRaw) {
            return null;
        }

        const currentTime = hasTime ? parseFloat(currentTimeRaw) : this.lastKnownState.currentTime;
        const duration = hasDuration ? parseFloat(durationRaw) : this.lastKnownState.duration;
        const playbackRate = hasRate ? parseFloat(rateRaw) : this.lastKnownState.playbackRate;
        const paused = typeof pausedRaw === 'boolean'
            ? pausedRaw
            : (typeof playingRaw === 'boolean' ? !playingRaw : this.lastKnownState.paused);
        const buffering = typeof bufferingRaw === 'boolean' ? bufferingRaw : this.lastKnownState.buffering;

        return {
            type: eventTypeRaw || 'timeupdate',
            currentTime,
            duration,
            playbackRate,
            paused,
            playing: !paused,
            buffering,
            ts: Date.now(),
            raw: data,
            source: 'provider-telemetry'
        };
    }

    emitTelemetry(snapshot, synthetic = false) {
        const now = Date.now();
        const merged = {
            ...this.lastKnownState,
            ...snapshot,
            ts: now,
            synthetic
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

    emitSyntheticTelemetry(reason = 'synthetic') {
        const now = Date.now();
        const elapsedSeconds = (now - this.lastTickAt) / 1000;
        const rate = this.lastKnownState.playbackRate || 1.0;
        let currentTime = this.lastKnownState.currentTime || 0;

        if (!this.lastKnownState.paused && elapsedSeconds > 0) {
            currentTime += elapsedSeconds * rate;
            if (this.lastKnownState.duration > 0) {
                currentTime = Math.min(currentTime, this.lastKnownState.duration);
            }
        }

        this.syntheticClockEnabled = true;
        console.log('[VAILISM TELEMETRY] Using synthetic telemetry fallback', {
            reason,
            currentTime,
            paused: this.lastKnownState.paused,
            playbackRate: rate
        });

        this.emitTelemetry({
            type: 'timeupdate',
            currentTime,
            duration: this.lastKnownState.duration,
            playbackRate: rate,
            paused: this.lastKnownState.paused,
            playing: !this.lastKnownState.paused,
            buffering: this.lastKnownState.buffering,
            source: 'synthetic-clock'
        }, true);
    }

    sendCommand(command, details = {}) {
        if (!this.iframe || !this.iframe.contentWindow) {
            console.warn(`[VAILISM PROVIDER] Unable to send ${command.toUpperCase()} command: iframe not ready`);
            return false;
        }

        const payload = {
            event: 'command',
            type: command,
            action: command,
            command,
            method: command,
            timestamp: Date.now(),
            ...details
        };

        try {
            console.log(`[VAILISM PROVIDER] Sending ${command.toUpperCase()} command`, payload);
            this.iframe.contentWindow.postMessage(payload, '*');

            if (command === 'play') {
                this.lastKnownState.paused = false;
                this.lastKnownState.playing = true;
            } else if (command === 'pause') {
                this.lastKnownState.paused = true;
                this.lastKnownState.playing = false;
            } else if (command === 'seek') {
                const time = Number.isFinite(parseFloat(details.time)) ? parseFloat(details.time) : this.lastKnownState.currentTime;
                this.lastKnownState.currentTime = time;
            } else if (command === 'setPlaybackRate') {
                const rate = Number.isFinite(parseFloat(details.rate)) ? parseFloat(details.rate) : this.lastKnownState.playbackRate;
                this.lastKnownState.playbackRate = rate;
            }

            return true;
        } catch (error) {
            console.warn(`[VAILISM PROVIDER] ${command.toUpperCase()} command failed`, error);
            return false;
        }
    }
    normalizeMessage(payload) { return null; }
}
