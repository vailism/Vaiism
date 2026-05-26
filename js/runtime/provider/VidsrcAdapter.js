import { ProviderAdapter } from './ProviderAdapter.js';

export class VidsrcAdapter extends ProviderAdapter {
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
        let data = payload;
        if (!data || typeof data !== 'object') return null;
        const rawEvent = String(data.event || data.type || data.action || data.command || '').toLowerCase();
        let type = null;
        if (rawEvent.includes('play')) type = 'play';
        else if (rawEvent.includes('pause')) type = 'pause';
        else if (rawEvent.includes('timeupdate')) type = 'timeupdate';
        const currentTime = parseFloat(data.time || data.currentTime) || 0;
        const duration = parseFloat(data.duration) || 0;
        return { type, currentTime, duration, playbackRate: 1.0, buffering: false, raw: data };
    }
}
