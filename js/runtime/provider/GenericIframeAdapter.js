import { ProviderAdapter } from './ProviderAdapter.js';

export class GenericIframeAdapter extends ProviderAdapter {
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

    send(data) {
        if (this.iframe && this.iframe.contentWindow) {
            const msg = typeof data === "string" ? data : JSON.stringify(data);
            this.iframe.contentWindow.postMessage(msg, "*");
        }
    }
    normalizeMessage(payload) {
        let data = payload;
        if (!data || typeof data !== 'object') return null;
        const rawEvent = (data.event || data.type || '').toLowerCase();
        let type = null;
        if (rawEvent.includes('play')) type = 'play';
        else if (rawEvent.includes('pause')) type = 'pause';
        else if (rawEvent.includes('timeupdate')) type = 'timeupdate';
        const currentTime = parseFloat(data.currentTime || data.time) || 0;
        const duration = parseFloat(data.duration) || 0;
        return { type, currentTime, duration, playbackRate: 1.0, buffering: false, raw: data };
    }
}
