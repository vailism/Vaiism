export class ProviderAdapter {
    constructor(iframe) {
        this.iframe = iframe;
    }
    play() {}
    pause() {}
    seek(time) {}
    setPlaybackRate(rate) {}
    normalizeMessage(payload) { return null; }
}
