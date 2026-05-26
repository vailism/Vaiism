import { ProviderAdapter } from './ProviderAdapter.js';

export class VidsrcAdapter extends ProviderAdapter {
    play() {
        this.send({ command: "play" });
        this.send("play");
    }
    pause() {
        this.send({ command: "pause" });
        this.send("pause");
    }
    seek(time) {
        this.send({ command: "seek", time: time });
    }
    setPlaybackRate(rate) {
        this.send({ command: "setPlaybackRate", rate: rate });
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
        const currentTime = parseFloat(data.time || data.currentTime) || 0;
        const duration = parseFloat(data.duration) || 0;
        return { type, currentTime, duration, playbackRate: 1.0, buffering: false, raw: data };
    }
}
