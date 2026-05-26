import { ProviderAdapter } from './ProviderAdapter.js';

export class VidlinkAdapter extends ProviderAdapter {
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
        if (data.data) data = data.data;
        if (typeof data === "string") {
            try { data = JSON.parse(data); } catch(ex) { return null; }
        }
        if (!data || typeof data !== 'object') return null;

        const rawEvent = String(data.event || data.type || data.action || data.command || '').toLowerCase();
        let type = null;
        if (rawEvent.includes('play') || rawEvent.includes('playing')) type = 'play';
        else if (rawEvent.includes('pause')) type = 'pause';
        else if (rawEvent.includes('timeupdate') || rawEvent.includes('progress')) type = 'timeupdate';
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
