export class ProviderAdapter {
    constructor(iframe) {
        this.iframe = iframe;
    }
    play() { return this.sendCommand('play'); }
    pause() { return this.sendCommand('pause'); }
    seek(time) { return this.sendCommand('seek', { time, currentTime: time, position: time }); }
    setPlaybackRate(rate) { return this.sendCommand('setPlaybackRate', { rate, playbackRate: rate }); }
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
            return true;
        } catch (error) {
            console.warn(`[VAILISM PROVIDER] ${command.toUpperCase()} command failed`, error);
            return false;
        }
    }
    normalizeMessage(payload) { return null; }
}
