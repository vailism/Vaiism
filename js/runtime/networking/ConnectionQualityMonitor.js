export class ConnectionQualityMonitor {
    constructor() {
        this.kernel = null;
        this.eventBus = null;
        this.rttPingInterval = null;
        this.rtt = 0;
    }

    injectKernel(kernel) {
        this.kernel = kernel;
        this.eventBus = kernel.get("eventBus");
    }

    onStart() {
        this.rtt = 0;
        this.eventBus.on("SOCKET_CONNECTED", () => {
            this.startRttPingLoop();
        });
        this.eventBus.on("SOCKET_DISCONNECTED", () => {
            this.stopRttPingLoop();
        });
    }

    onStop() {
        this.stopRttPingLoop();
    }

    startRttPingLoop() {
        this.stopRttPingLoop();
        this.rttPingInterval = setInterval(() => {
            try {
                const socket = this.kernel.get("socket");
                if (!socket || !socket.isConnected()) return;
                const pingStart = Date.now();
                
                socket.once('heartbeat-ack', () => {
                    this.rtt = Date.now() - pingStart;
                    this.eventBus.emit("RTT_MEASURED", this.rtt);
                });
                socket.emitHeartbeat();
            } catch (e) {
                console.error("[ConnectionQualityMonitor] Error in RTT ping loop:", e);
            }
        }, 5000);
    }

    stopRttPingLoop() {
        if (this.rttPingInterval) {
            clearInterval(this.rttPingInterval);
            this.rttPingInterval = null;
        }
    }
}
