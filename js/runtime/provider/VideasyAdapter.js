import { ProviderAdapter } from './ProviderAdapter.js';

export class VideasyAdapter extends ProviderAdapter {
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
        return this.sendCommand('play');
    }

    pause() {
        return this.sendCommand('pause');
    }

    seek(time) {
        return this.sendCommand('seek', { time, currentTime: time, position: time });
    }

    setPlaybackRate(rate) {
        return this.sendCommand('setPlaybackRate', { rate, playbackRate: rate });
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
            provider: 'videasy',
            timestamp: Date.now(),
            ...details
        };

        try {
            console.log(`[VAILISM PROVIDER] Sending ${command.toUpperCase()} command`, payload);
            this.iframe.contentWindow.postMessage(payload, '*');
            return true;
        } catch (error) {
            console.warn(`[VAILISM PROVIDER] ${command.toUpperCase()} command failed`, error);
            return false;
        }
    }

    normalizeMessage(payload) {
        let data = payload;
        if (!data || typeof data !== 'object') return null;
        if (data.data) data = data.data;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (error) { return null; }
        }
        if (!data || typeof data !== 'object') return null;

        const rawEvent = String(data.event || data.type || data.action || data.command || '').toLowerCase();
        let type = null;
        if (rawEvent.includes('play')) type = 'play';
        else if (rawEvent.includes('pause')) type = 'pause';
        else if (rawEvent.includes('timeupdate') || rawEvent.includes('progress') || rawEvent.includes('tick')) type = 'timeupdate';
        else if (rawEvent.includes('ended') || rawEvent.includes('complete')) type = 'ended';
        else if (rawEvent.includes('waiting') || rawEvent.includes('buffering')) type = 'buffering';
        else if (rawEvent.includes('ready') || rawEvent.includes('loaded')) type = 'ready';

        const currentTime = parseFloat(data.currentTime !== undefined ? data.currentTime : (data.time !== undefined ? data.time : data.position)) || 0;
        const duration = parseFloat(data.duration !== undefined ? data.duration : data.length) || 0;
        const playbackRate = parseFloat(data.playbackRate !== undefined ? data.playbackRate : (data.rate !== undefined ? data.rate : 1.0)) || 1.0;
        const buffering = !!(data.buffering || rawEvent.includes('buffering') || rawEvent.includes('waiting'));

        return { type, currentTime, duration, playbackRate, buffering, raw: data };
    }
}